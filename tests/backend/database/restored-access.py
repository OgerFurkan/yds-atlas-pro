"""Full-schema restore acceptance for the disposable service namespace, using Atlas capture."""
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
from tempfile import TemporaryDirectory
import time
import urllib.error
import urllib.request
import uuid

def rehearsal(root, tag, docker, sql, ports):
    with TemporaryDirectory(prefix="atlas-restore-witness-") as checkpoint_dir:
        _rehearsal(root, tag, docker, sql, ports, checkpoint_dir)

def _rehearsal(root, tag, docker, sql, ports, checkpoint_dir):
    auth,rest=ports["AUTH"],ports["REST"]
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    def http(port,path,token=None,body=None):
        headers={"Connection":"close","Content-Type":"application/json"}
        if token:headers["Authorization"]="Bearer "+token
        request=urllib.request.Request("http://127.0.0.1:"+str(port)+path,
            data=None if body is None else json.dumps(body).encode(),headers=headers)
        try:
            with opener.open(request,timeout=6) as response:return response.status,json.loads(response.read() or b"null")
        except urllib.error.HTTPError as exc:return exc.code,None
    def account():
        status,value=http(auth,"/signup",body={"email":uuid.uuid4().hex+"@atlas-test.invalid","password":secrets.token_urlsafe(32)})
        assert status==200
        return uuid.UUID(value["user"]["id"]),value["access_token"],value["refresh_token"]
    a,old,refresh=account(); b,live,_=account()
    sql(f"insert into public.words(user_id,word,score) values('{a}','SyntheticErase',32),('{b}','SyntheticKeep',84)")
    sql(f"insert into atlas_account.plans(user_id,revision,document,command_id,fingerprint) values ('{b}',2,'{{}}','{uuid.uuid4()}',sha256('synthetic'));")
    sql("insert into public.atlas_lexicon_jobs(word_key,part_of_speech,sense_key,status,last_error_code) values('rehearsal','Noun','synthetic','failed','SYNTHETIC_RETRY')")
    sql("insert into public.atlas_tooltip_queue(word_key,status,attempts,last_error_code) values('rehearsal','retry',2,'SYNTHETIC_RETRY')")
    content_tables = ("atlas_lexicon_entries", "atlas_lexicon_entry_revisions", "atlas_lexicon_jobs", "atlas_tooltip_queue")
    def content_fingerprint(query, table):
        result = query(f"select count(*)::text || ':' || encode(sha256(convert_to(string_agg(to_jsonb(r)::text, chr(10) order by to_jsonb(r)::text collate \"C\"), 'UTF8')), 'hex') from public.{table} r")
        if not re.fullmatch(r"[1-9][0-9]*:[0-9a-f]{64}", result):
            raise ValueError("Missing synthetic contents for " + table)
        return result
    runtime=root/"scripts/quality/atlas-recovery/runtime"
    for suffix in ["-rest","-auth"]:docker("stop","-t","4",tag+suffix)
    fingerprints = {table: content_fingerprint(sql, table) for table in content_tables}
    docker("exec",tag,"mkdir","-m","700","/atlas-runtime","/tmp/atlas-capture")
    for name in ["postgres.sh","summary.sql","sequences.sql"]:
        docker("cp",str(runtime/name),tag+":/atlas-runtime/"+name)
    capture_start=time.monotonic()
    docker("exec","-e","PGUSER=supabase_admin","-e","PGDATABASE=postgres",tag,"bash","-c",
        "source /atlas-runtime/postgres.sh; archive_capture /tmp/atlas-capture; cd /tmp/atlas-capture; sha256sum database.dump source-summary.txt >receipt")
    capture_ms=round((time.monotonic()-capture_start)*1000)
    dataset=uuid.uuid4().hex
    env={**os.environ,"TEMP":checkpoint_dir,"TMP":checkpoint_dir,"ATLAS_FIXTURE_DATASET":dataset,"ATLAS_FIXTURE_OWNER":a.hex}
    common="""$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $ascii=[Text.Encoding]::ASCII;
    . ./scripts/quality/atlas-recovery/security.ps1; . ./scripts/quality/atlas-recovery/deletion-decisions.ps1;
    """
    def ledger(cmd):
        r=subprocess.run(["powershell","-NoProfile","-NonInteractive","-Command",common+cmd],cwd=root,env=env,capture_output=True,text=True,timeout=20)
        if r.returncode:raise RuntimeError("Independent deletion checkpoint failed")
        return r.stdout.strip()
    receipt=json.loads(ledger("New-SyntheticDeletionGate $env:ATLAS_FIXTURE_DATASET $env:ATLAS_FIXTURE_OWNER | ConvertTo-Json -Compress"))
    env["ATLAS_FIXTURE_RECEIPT"]=json.dumps(receipt)
    # Synthetic independent authority only. Its floor and key are outside both databases.
    witness_path = Path(receipt["Witness"]).resolve()
    if not witness_path.is_relative_to(Path(checkpoint_dir).resolve()):
        raise RuntimeError("Invalid synthetic witness path")
    verified_owner = ledger("Confirm-SyntheticDeletionGate (ConvertFrom-Json $env:ATLAS_FIXTURE_RECEIPT)")
    if verified_owner != a.hex:
        raise RuntimeError("Restore checkpoint identity mismatch")
    witness_dataset, floor_text, head = witness_path.read_text(encoding="ascii").split("|")
    if witness_dataset != dataset or floor_text != "1" or not re.fullmatch(r"[a-f0-9]{64}",head):
        raise RuntimeError("Invalid synthetic witness head")
    floor = int(floor_text)
    witness_key = secrets.token_bytes(32)
    identity = {"environment":"pre","project":dataset[:20],"keyId":uuid.uuid4().hex}
    def witness(environment, sequence, tail):
        body = json.dumps([1,environment,identity["project"],sequence,tail],separators=(",",":"))
        mac = hmac.new(witness_key,body.encode("ascii"),hashlib.sha256).hexdigest()
        return {"environment":environment,"project":identity["project"],"sequence":sequence,
                "head":tail,"mac":mac}
    current_witness = witness(identity["environment"],floor,head)
    def promotion_witness(observation):
        code = """
import { readFileSync } from 'node:fs';
import { checkDeletionWitness } from './scripts/quality/atlas-recovery/publication.mjs';
const input=JSON.parse(readFileSync(0,'utf8'));
const key=Buffer.from(input.key,'hex');
try {
  process.stdout.write(checkDeletionWitness(input.identity,input.observation,input.floor,key));
} catch { process.exitCode=1; }
finally { key.fill(0); }
"""
        payload={"key":witness_key.hex(),"identity":identity,"floor":floor,"observation":observation}
        result=subprocess.run(["node","--input-type=module","-e",code],cwd=root,input=json.dumps(payload),
                              capture_output=True,text=True,timeout=10)
        if result.returncode != 0 or result.stdout != head:
            raise RuntimeError("Restore access blocked by witness")
        if witness_path.read_text(encoding="ascii") != f"{dataset}|{floor}|{head}":
            raise RuntimeError("Restore access blocked by ledger rollback")
    def decision():
        if receipt["Dataset"]!=dataset or receipt["Owner"]!=a.hex:raise RuntimeError("Restore checkpoint identity mismatch")
        value=ledger("Confirm-SyntheticDeletionGate (ConvertFrom-Json $env:ATLAS_FIXTURE_RECEIPT)")
        if not re.fullmatch("[0-9a-f]{32}",value) or uuid.UUID(value)!=a:raise ValueError("Decision owner changed")
        return uuid.UUID(value)
    sql(f"delete from auth.users where id='{decision()}'")
    restore_start=time.monotonic()
    # A conflicting target forces an error after restore has begun. The failed
    # transaction must neither leave restored tables nor alter the valid archive.
    sql("create database atlas_interrupted template template0")
    docker("exec",tag,"psql","-U","supabase_admin","-d","atlas_interrupted","-v","ON_ERROR_STOP=1","-c","create schema auth")
    docker("exec",tag,"bash","-ceu",
        'cd /tmp/atlas-capture; sha256sum --check receipt; '
        'if pg_restore -U supabase_admin --exit-on-error --single-transaction -d atlas_interrupted database.dump 2>/dev/null; then exit 1; fi; '
        'sha256sum --check receipt')
    absent = docker("exec",tag,"psql","-U","supabase_admin","-d","atlas_interrupted","-XqAt","-v","ON_ERROR_STOP=1","-c","select to_regclass('public.words') is null")
    assert absent=="t"
    sql("create database atlas_restored template template0")
    docker("exec",tag,"bash","-c","cd /tmp/atlas-capture && sha256sum --check receipt && pg_restore -U supabase_admin --exit-on-error --single-transaction -d atlas_restored database.dump")
    def target(q):
        return docker("exec","-i",tag,"psql","-U","supabase_admin","-XqAt","-v","ON_ERROR_STOP=1","-d","atlas_restored",stdin=q.encode())
    # The restored archive genuinely predates the deletion. Keep both APIs stopped until replay completes.
    assert target(f"select count(*) from auth.users where id='{a}'")=="1"
    assert int(target(f"select count(*) from auth.sessions where user_id='{a}'"))>0
    for _ in range(2):
        owner=decision()
        target(f"delete from auth.users where id='{owner}'")
    assert target(f"select count(*) from auth.sessions where user_id='{a}'")=="0"
    assert target(f"select revision from atlas_account.plans where user_id='{b}'")=="2"
    assert target(f"select score from public.words where user_id='{b}' and word='SyntheticKeep'")=="84"
    for table, expected in fingerprints.items():
        assert content_fingerprint(target, table) == expected, table
    def maintenance(q):
        docker("exec","-i",tag,"psql","-U","supabase_admin","-XqAt","-v","ON_ERROR_STOP=1","-d","template1",stdin=q.encode())
    for invalid in (None, witness("pre",floor-1,"0"*64), witness("prod",floor,head)):
        try:
            promotion_witness(invalid)
        except RuntimeError as reason:
            assert str(reason)=="Restore access blocked by witness"
        else:
            raise RuntimeError("Invalid witness allowed access")
    for suffix in ["-auth","-rest"]:
        assert docker("inspect","--format","{{.State.Running}}",tag+suffix)=="false"
    promotion_witness(current_witness)
    maintenance("alter database postgres rename to atlas_before; alter database atlas_restored rename to postgres;")
    for suffix in ["-auth","-rest"]:docker("start",tag+suffix)
    for n in range(40):
        try:
            if http(auth,"/health")[0]==200 and http(rest,"/words?select=id",live)[0]==200:break
        except (OSError,ValueError):pass
        time.sleep(.25)
    else:raise RuntimeError("Restored services did not become ready")
    assert http(rest,"/words",old)[0]==401
    assert http(rest,"/rpc/atlas_read_plan",old,{})[0]==401
    assert http(auth,"/user",old)[0] in (401,403,404)
    assert 400<=http(auth,"/token?grant_type=refresh_token",body={"refresh_token":refresh})[0]<500
    status,rows=http(rest,"/words?select=word,score",live)
    assert status==200 and rows==[{"word":"SyntheticKeep","score":84}]
    print("PASS pre-deletion full-schema archive, independent checkpoint, isolated target, double replay, revoked Auth/Data API/RPC, surviving tenant, canonical entries, revisions and both work queues",flush=True)
    print("PASS class=restore_promotion_witness",flush=True)
    print(f"PASS class=restore_duration capture_ms={capture_ms} restore_acceptance_ms={round((time.monotonic()-restore_start)*1000)}",flush=True)
