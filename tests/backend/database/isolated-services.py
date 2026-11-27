"""Launch the existing Bun suite on three disposable services without external networking."""
import base64
import hashlib
import hmac
import json
import runpy
import argparse
import os
from pathlib import Path
import re
import secrets
import socket
import socketserver
import subprocess as sp
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parents[3]
CLI = ["docker", "--context", "desktop-linux"]
IMAGES = {"": "postgres:17.11", "-auth": "supabase/gotrue:v2.197.0", "-rest": "postgrest/postgrest:v16.5"}

def docker(*args, stdin=None):
    p=sp.run(CLI+list(args),input=stdin,capture_output=True,timeout=60)
    if p.returncode:
        raise RuntimeError("Docker "+args[0]+" failed")  # never log environment or connection strings
    return p.stdout.decode().strip()

def endpoint():
    if not __debug__ or docker("context","inspect","--format","{{.Endpoints.docker.Host}}")!="npipe:////./pipe/dockerDesktopLinuxEngine":
        raise RuntimeError("Verified LOCAL Docker and enabled fixture assertions required")

def cleanup(tag,active=False):
    endpoint()
    if not re.fullmatch("atlas-2b-[0-9a-f]{32}",tag):raise ValueError("Invalid test identity")
    for suffix in ["-rest","-auth",""]:
        name=tag+suffix
        ids=docker("ps","-aq","--no-trunc","--filter","name=^/"+name+"$").splitlines()
        if not ids:continue
        ident,=ids
        row=docker("inspect","--format",'{{.Name}} {{index .Config.Labels "atlas.test"}} {{.Image}} {{json .Mounts}} {{.State.Status}}',ident).split()
        if row[:4]!=["/"+name,tag,docker("image","inspect","--format","{{.Id}}",IMAGES[suffix]),"[]"]:
            raise RuntimeError("Cleanup ownership mismatch")
        if row[4]=="running":
            if not active:raise RuntimeError("Stopped runs only")
            docker("stop","-t","4",ident)
        docker("rm",ident)

class Relay(socketserver.ThreadingTCPServer):
    # Keep the loopback backlog large enough for the concurrent REST contract checks.
    request_queue_size = socket.SOMAXCONN
    daemon_threads=True

class Forward(socketserver.BaseRequestHandler):
    def handle(self):
        # A server closing an idle keep-alive socket must also close the host relay.
        cmd = (f"exec 3<>/dev/tcp/127.0.0.1/{self.server.target} 4<&0 || exit 1; "
               "cat <&3 & reader=$!; cat <&4 >&3 & writer=$!; "
               'wait -n "$reader" "$writer"; kill "$reader" "$writer" 2>/dev/null || true; wait')
        p=sp.Popen(CLI+["exec","-i",self.server.tag,"bash","-c",cmd],stdin=sp.PIPE,stdout=sp.PIPE,stderr=sp.DEVNULL,bufsize=0)
        def upload():
            try:
                while chunk:=self.request.recv(65536):p.stdin.write(chunk)
            except OSError:pass
            finally:
                try:p.stdin.close()
                except OSError:pass
        threading.Thread(target=upload,daemon=True).start()
        try:
            while chunk:=p.stdout.read(65536):self.request.sendall(chunk)
        except OSError:pass
        finally:
            p.stdout.close()
            if p.poll() is None:p.terminate()
            p.wait(timeout=5)

def run(include_restore=True, allocate_ports=False, restore_only=False):
    endpoint()
    tag="atlas-2b-"+uuid.uuid4().hex
    print("LOCAL run",tag,flush=True)
    pins={s:docker("image","inspect","--format","{{.Id}}",img) for s,img in IMAGES.items()}
    pw=secrets.token_hex(24);jwt=secrets.token_hex(48)
    servers=[]
    started=[]
    def sql(statement):
        return docker("exec","-i",tag,"psql","-U","supabase_admin","-d","postgres","-XqAt","-v","ON_ERROR_STOP=1",stdin=statement.encode())
    def start(suffix,env,extra=()):
        args=["run","-d","--pull","never","--name",tag+suffix,"--label","atlas.test="+tag,"--network","container:"+tag if suffix else "none"]
        for k,v in env.items():args+=["-e",k+"="+v]
        docker(*args,*extra,pins[suffix])
    def wait(name,probe):
        end=time.monotonic()+50
        while time.monotonic()<end:
            try:probe();return
            except RuntimeError:
                suffix={"GoTrue":"-auth","PostgREST schema cache":"-rest"}.get(name,"")
                if docker("inspect","--format","{{.State.Status}}",tag+suffix)=="exited":
                    proc=sp.run(CLI+["logs","--tail","3",tag+suffix],capture_output=True,text=True)
                    print((proc.stdout+proc.stderr).replace(pw,"[synthetic]").replace(jwt,"[synthetic]")[-1300:],flush=True)
                    raise RuntimeError(name+" exited during startup")
                time.sleep(.4)
        raise RuntimeError(name+" readiness timed out")
    def ready(port,path):
        docker("exec",tag,"bash","-c",f"exec 3<>/dev/tcp/127.0.0.1/{port}; printf 'GET {path} HTTP/1.0\\r\\nHost: localhost\\r\\n\\r\\n' >&3; read -rt 3 status <&3; [[ $status == *' 200 '* ]]")
    try:
        ports = {}
        for name, fixed, target in [("DB",55422,5432),("AUTH",55429,9999),("REST",55421,3000)]:
            # An ephemeral port stays reserved by this run's relay until cleanup.
            srv=Relay(("127.0.0.1",0 if allocate_ports else fixed),Forward)
            servers.append(srv)
            ports[name]=srv.server_address[1]
            srv.target=target
            srv.tag=tag
        start("",{"POSTGRES_PASSWORD":pw,"POSTGRES_USER":"supabase_admin","POSTGRES_DB":"postgres"},["--tmpfs","/var/lib/postgresql/data:rw,nosuid","--tmpfs","/tmp:rw,nosuid,nodev"])
        wait("PostgreSQL",lambda:docker("exec",tag,"pg_isready","-h","127.0.0.1","-U","supabase_admin"))
        sql(f"""create role postgres superuser; create role anon; create role authenticated; create role service_role bypassrls;
        create role authenticator login noinherit password '{pw}'; grant anon,authenticated,service_role to authenticator;
        create role supabase_auth_admin login createrole password '{pw}'; create schema auth authorization supabase_auth_admin;
        alter role supabase_auth_admin set search_path=auth; grant usage on schema auth to authenticated,anon,service_role;
""")
        start("-auth",{"GOTRUE_DB_DRIVER":"postgres","GOTRUE_DB_DATABASE_URL":f"postgres://supabase_auth_admin:{pw}@127.0.0.1/postgres?sslmode=disable","GOTRUE_SITE_URL":f"http://127.0.0.1:{ports['AUTH']}","API_EXTERNAL_URL":f"http://127.0.0.1:{ports['AUTH']}","GOTRUE_API_HOST":"127.0.0.1","PORT":"9999","GOTRUE_API_PORT":"9999","GOTRUE_JWT_SECRET":jwt,"GOTRUE_JWT_AUD":"authenticated","GOTRUE_JWT_DEFAULT_GROUP_NAME":"authenticated","GOTRUE_EXTERNAL_EMAIL_ENABLED":"true","GOTRUE_MAILER_AUTOCONFIRM":"true","GOTRUE_DISABLE_SIGNUP":"false"})
        wait("GoTrue",lambda:ready(9999,"/health"))
        sql("""create or replace function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub'))::uuid$$;""")
        for file in sorted((ROOT/"supabase/migrations").glob("*.sql")):
            if file.name.endswith("_control_and_session_gate.sql"):
                sql((Path(__file__).parent/"legacy-tooltip.fixture.sql").read_text(encoding="utf-8"))
            print("Apply",file.name,flush=True);sql(file.read_text(encoding="utf-8-sig"))
        sql(f"alter role atlas_assessment_api password '{pw}'")
        start("-rest",{"PGRST_DB_URI":f"postgres://authenticator:{pw}@127.0.0.1/postgres","PGRST_DB_SCHEMAS":"public","PGRST_DB_ANON_ROLE":"anon","PGRST_DB_MAX_ROWS":"1000","PGRST_JWT_SECRET":jwt,"PGRST_SERVER_HOST":"127.0.0.1","PGRST_ADMIN_SERVER_PORT":"3001"})
        wait("PostgREST schema cache",lambda:ready(3001,"/ready"))
        for srv in servers:
            threading.Thread(target=srv.serve_forever,daemon=True).start();started.append(srv)
        env={**os.environ,**{f"ATLAS_ISOLATED_{name}_PORT":str(port) for name,port in ports.items()},
             "ATLAS_ISOLATED_TEST_ADMIN_URL":f"postgres://supabase_admin:{pw}@127.0.0.1:{ports['DB']}/postgres",
             "ATLAS_ISOLATED_TEST_WRITER_URL":f"postgres://atlas_assessment_api:{pw}@127.0.0.1:{ports['DB']}/postgres"}
        def b64(data):return base64.urlsafe_b64encode(data).rstrip(b"=")
        parts=b".".join(b64(json.dumps(v).encode()) for v in [{"alg":"HS256","typ":"JWT"},{"role":"service_role","exp":int(time.time())+600}])
        env["ATLAS_ISOLATED_SERVICE_KEY"]=(parts+b"."+b64(hmac.new(jwt.encode(),parts,hashlib.sha256).digest())).decode()
        if not restore_only: sp.run(["bun","--no-install","--no-env-file","test","tests/backend/database/isolated-score-security.test.ts"],env=env,cwd=ROOT,timeout=265,check=True)
        if include_restore:
            runpy.run_path(str(Path(__file__).with_name("restored-access.py")))["rehearsal"](ROOT,tag,docker,sql,ports)
    finally:
        for srv in started:srv.shutdown()
        for srv in servers:srv.server_close()
        cleanup(tag,active=True)

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--cleanup-stopped",metavar="RUN_ID")
    p.add_argument("--skip-restore", action="store_true", help="Run service contracts without repeating the separate archive rehearsal")
    p.add_argument("--restore-only", action="store_true", help="Run the isolated restore regression only")
    p.add_argument("--allocate-ports", action="store_true", help="Reserve disposable loopback ports for service contracts")
    args=p.parse_args()
    if args.restore_only and (args.skip_restore or args.cleanup_stopped):
        p.error("--restore-only requires an isolated restore run")
    if args.allocate_ports and args.cleanup_stopped:
        p.error("--allocate-ports cannot be used for cleanup")
    if args.cleanup_stopped:cleanup(args.cleanup_stopped)
    else:run(include_restore=not args.skip_restore, allocate_ports=args.allocate_ports, restore_only=args.restore_only)
