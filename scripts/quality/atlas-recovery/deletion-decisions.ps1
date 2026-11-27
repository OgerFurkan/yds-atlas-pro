# Atlas trust receipts are stored outside the database/archive. The expected latest
# head must come from an independently retained, authenticated monotonic checkpoint.
function Read-AtlasDecisions([string]$Dataset,[string[]]$Records,[string]$ExpectedHead) {
    if ($Dataset -cnotmatch '\A[0-9a-f]{32}\z' -or -not $ExpectedHead) { throw 'deletion_head' }
    $previous = '0' * 64
    $owners = [Collections.Generic.Dictionary[string,string]]::new()
    $number = 0
    foreach ($line in $Records) {
        $number++
        $fields = $line.Split('|')
        if ($fields.Count -ne 7 -or $fields[0] -cne 'atlas-del-v1' -or $fields[1] -cne $Dataset -or
            $fields[2] -cne [string]$number -or $fields[3] -cne $previous -or
            $fields[4] -cnotmatch '\A[0-9a-f]{32}\z' -or $fields[5] -cnotmatch '\A[0-9a-f]{32}\z' -or
            $fields[6] -cnotmatch '\A[0-9a-f]{64}\z' -or $owners.ContainsKey($fields[4])) { throw 'deletion_record' }
        $body = $fields[0..5] -join '|'
        if (-not (Equal-Mac (Sign-Receipt $body) $fields[6])) { throw 'deletion_record' }
        $previous = $fields[6]
        $owners.Add($fields[4],$fields[5])
    }
    $head = "$Dataset|$number|$previous"
    if ($head -cne $ExpectedHead) { throw 'deletion_head' }
    [pscustomobject]@{ Head=$head; Operations=$owners; Count=$number; Tail=$previous }
}

function Get-AtlasDecisionRecords([string]$Directory) {
    Assert-PrivatePath $Directory $true
    $number = 0
    foreach ($path in [IO.Directory]::GetFileSystemEntries($Directory) | Sort-Object) {
        $number++
        if ([IO.Path]::GetFileName($path) -cne ('{0:D10}.receipt' -f $number)) { throw 'deletion_record' }
        Assert-PrivatePath $path $false
        if ((Get-Item -LiteralPath $path).Length -gt 384) { throw 'deletion_record' }
        [IO.File]::ReadAllText($path,$ascii)
    }
}

function Add-AtlasDecision([string]$Directory,[string]$Dataset,[string]$ExpectedHead,[string]$Operation,[string]$Owner) {
    if ($Operation -cnotmatch '\A[0-9a-f]{32}\z' -or $Owner -cnotmatch '\A[0-9a-f]{32}\z') { throw 'deletion_record' }
    $records = @(Get-AtlasDecisionRecords $Directory)
    # Lost acknowledgement: admit at most the exact, signed next operation.
    if ($records.Count -gt 0) {
        $last = $records[-1].Split('|')
        if ($last.Count -eq 7 -and $last[4] -ceq $Operation -and $last[5] -ceq $Owner -and
            $ExpectedHead -ceq "$Dataset|$($records.Count-1)|$($last[3])") {
            return Read-AtlasDecisions $Dataset $records "$Dataset|$($records.Count)|$($last[6])"
        }
    }
    $state = Read-AtlasDecisions $Dataset $records $ExpectedHead
    if ($state.Operations.ContainsKey($Operation)) {
        if ($state.Operations[$Operation] -cne $Owner) { throw 'deletion_owner' }
        return $state
    }
    $next = $state.Count + 1
    $body = "atlas-del-v1|$Dataset|$next|$($state.Tail)|$Operation|$Owner"
    $mac = Sign-Receipt $body
    $record = "$body|$mac"
    # CreateNew + Flush(true) also arbitrates simultaneous writers at the same sequence.
    New-File (Join-Path $Directory ('{0:D10}.receipt' -f $next)) ($ascii.GetBytes($record))
    return Read-AtlasDecisions $Dataset (@($records) + $record) "$Dataset|$next|$mac"
}

function New-SyntheticDeletionGate([string]$Dataset='12345678123456781234567812345678',[string]$Owner='11111111111141118111111111111111') {
    if ($Dataset -cnotmatch '\A[0-9a-f]{32}\z' -or $Owner -cnotmatch '\A[0-9a-f]{32}\z') { throw 'deletion_record' }
    Add-Type -AssemblyName System.Security
    # No online deletion or real archive. This trust root and witness belong exclusively to this run.
    $run = [guid]::NewGuid().ToString('N')
    $trustRoot = Join-Path ([IO.Path]::GetTempPath()) "atlas-synthetic-decision-$run"
    $witness = Join-Path ([IO.Path]::GetTempPath()) "atlas-synthetic-witness-$run"
    New-PrivateDirectory $trustRoot
    New-PrivateDirectory $witness
    $directory = Join-Path $trustRoot 'entries'
    New-PrivateDirectory $directory
    $entropy = $ascii.GetBytes("atlas-synthetic-decisions-$run")
    $key = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($key)
        New-File (Join-Path $trustRoot 'trust.dpapi') ([Security.Cryptography.ProtectedData]::Protect($key,$entropy,'CurrentUser'))
    } finally { $rng.Dispose(); [Array]::Clear($key,0,32) }
    $genesis = "$dataset|0|$('0' * 64)"
    $decision = Add-AtlasDecision $directory $dataset $genesis $run $owner
    $retry = Add-AtlasDecision $directory $dataset $genesis $run $owner
    if ($retry.Head -cne $decision.Head) { throw 'deletion_retry' }
    $headPath = Join-Path $witness 'confirmed-head'
    New-File $headPath ($ascii.GetBytes($decision.Head))
    Assert-PrivatePath $headPath $false
    $expected = [IO.File]::ReadAllText($headPath,$ascii)
    $records = @(Get-AtlasDecisionRecords $directory)
    Expect-Rejection { Read-AtlasDecisions $dataset @() $expected } 'deletion_head'
    Expect-Rejection { Read-AtlasDecisions $dataset $records $genesis } 'deletion_head'
    Expect-Rejection { Read-AtlasDecisions $dataset @($records[0].Replace($owner,('9'*32))) $expected } 'deletion_record'
    $verified = Read-AtlasDecisions $dataset $records $expected
    if ($verified.Operations.Count -ne 1 -or $verified.Operations[$run] -cne $owner) { throw 'deletion_owner' }
    [pscustomobject]@{ Directory=$directory; Trust=$trustRoot; Witness=$headPath; Dataset=$dataset; Operation=$run; Owner=$verified.Operations[$run] }
}

function Confirm-SyntheticDeletionGate($Receipt) {
    $trustRoot=$Receipt.Trust
    $entropy=$ascii.GetBytes("atlas-synthetic-decisions-$($Receipt.Operation)")
    Assert-PrivatePath $Receipt.Witness $false
    $expected=[IO.File]::ReadAllText($Receipt.Witness,$ascii)
    $decision=Read-AtlasDecisions $Receipt.Dataset @(Get-AtlasDecisionRecords $Receipt.Directory) $expected
    if ($decision.Operations.Count -ne 1 -or $decision.Operations[$Receipt.Operation] -cne $Receipt.Owner) { throw 'deletion_owner' }
    return $decision.Operations[$Receipt.Operation]
}
