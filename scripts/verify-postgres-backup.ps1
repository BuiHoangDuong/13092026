param(
  [Parameter(Mandatory = $true)][string]$SourceDatabaseUrl,
  [Parameter(Mandatory = $true)][string]$RestoreDatabaseUrl,
  [Parameter(Mandatory = $true)][ValidateSet('RESTORE_DEDICATED_TARGET')][string]$ConfirmRestoreTarget
)

$ErrorActionPreference = 'Stop'
$source = [Uri]$SourceDatabaseUrl
$target = [Uri]$RestoreDatabaseUrl
if ($source.Scheme -notin @('postgres', 'postgresql') -or $target.Scheme -notin @('postgres', 'postgresql')) { throw 'Both URLs must be PostgreSQL URLs' }
if ($source.Host -eq $target.Host -and $source.Port -eq $target.Port -and $source.AbsolutePath -eq $target.AbsolutePath) { throw 'Restore target must be a different database' }

foreach ($tool in @('pg_dump', 'pg_restore', 'psql')) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is required on PATH" }
}

function Invoke-PgTool([string]$Tool, [Uri]$Database, [string[]]$Arguments) {
  $password = [Uri]::UnescapeDataString($Database.UserInfo.Split(':', 2)[1])
  $username = [Uri]::UnescapeDataString($Database.UserInfo.Split(':', 2)[0])
  $previousPassword = $env:PGPASSWORD
  $env:PGPASSWORD = $password
  try {
    & $Tool '-h' $Database.Host '-p' $Database.Port '-U' $username '-d' $Database.AbsolutePath.TrimStart('/') @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Tool failed with exit code $LASTEXITCODE" }
  } finally { $env:PGPASSWORD = $previousPassword }
}

$dumpPath = Join-Path ([System.IO.Path]::GetTempPath()) ("cashback-backup-{0}.dump" -f [Guid]::NewGuid().ToString('N'))
try {
  Invoke-PgTool 'pg_dump' $source @('--format=custom', '--no-owner', '--no-acl', '--file', $dumpPath)
  Invoke-PgTool 'pg_restore' $target @('--clean', '--if-exists', '--no-owner', '--no-acl', '--exit-on-error', $dumpPath)
  $migrationCount = Invoke-PgTool 'psql' $target @('--tuples-only', '--no-align', '--command', 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;')
  $tableCount = Invoke-PgTool 'psql' $target @('--tuples-only', '--no-align', '--command', "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';")
  if ([int]($migrationCount | Select-Object -Last 1) -lt 1 -or [int]($tableCount | Select-Object -Last 1) -lt 1) { throw 'Restored database verification returned no migrations or tables' }
  Write-Output "PASS: backup restored with $migrationCount applied migrations and $tableCount public tables"
} finally {
  if (Test-Path -LiteralPath $dumpPath) { Remove-Item -LiteralPath $dumpPath -Force }
}
