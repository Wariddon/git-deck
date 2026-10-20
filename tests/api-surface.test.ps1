$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'git-dashboard-server.ps1'),[ref]$null,[ref]$null)
$fn=$ast.FindAll({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-GitCapture'},$false)[0]
. ([scriptblock]::Create($fn.Extent.Text.Replace('$items =',("`$ErrorActionPreference='Continue'`n    `$items ="))))
. (Join-Path $root 'lib\GitDeck.MultiRepo.ps1')
. (Join-Path $root 'lib\GitDeck.ApiMap.ps1')
function Assert-Registered($Path){}
function Write-Text([string]$File,[string]$Text){[void](New-Item -ItemType Directory -Force -Path (Split-Path $File -Parent));[IO.File]::WriteAllText($File,$Text)}
$base=Join-Path $root ('output\api-surface-test-'+[guid]::NewGuid().ToString('N'))
try{
    [void](New-Item -ItemType Directory -Force -Path $base);& git -C $base init -q -b main
    Write-Text (Join-Path $base 'src/main/java/a/CaseController.java') "@RestController`n@RequestMapping(`"/v1/svc/case`")`npublic class CaseController {`n  @PostMapping(`"/create`")`n  public void create() {}`n  @GetMapping(value = `"/{id}`")`n  public void get() {}`n}`n"
    Write-Text (Join-Path $base 'src/main/java/a/EapiClient.java') "@FeignClient(name = `"eapi`")`npublic interface EapiClient {`n  @PostMapping(`"/sales-services/v1/customerServices/promptPay/findByProxy`")`n  void find();`n}`n"
    Write-Text (Join-Path $base 'src/main/java/a/Listener.java') "public class Listener {`n  @KafkaListener(topics = `"`${app.kafka.case-topic}`")`n  void on() {}`n  void send() { kafkaTemplate.send(`"case-done`", x); }`n}`n"
    Write-Text (Join-Path $base 'src/main/resources/application.yml') "app:`n  kafka:`n    case-topic: case-created`neapi:`n  find:`n    url: `${enterprise-api.host}/v2/customerServices/promptPay/findByProxy`n"
    Write-Text (Join-Path $base 'src/test/java/a/T.java') "public class T { String u = `"/v1/test/only`"; }`n"
    $s=Get-GitDeckApiSurface $base ''
    $provides=@($s.provides|ForEach-Object{"$($_.method) $($_.path)"}) -join ','
    if($provides -ne 'POST /v1/svc/case/create,GET /v1/svc/case/{id}'){throw "Provides: $provides"}
    $calls=@($s.calls|ForEach-Object{"$($_.via) $($_.path)"})
    if(-not ($calls -contains 'feign /sales-services/v1/customerServices/promptPay/findByProxy') -or -not ($calls -contains 'config /v2/customerServices/promptPay/findByProxy')){throw "Calls: $($calls -join ',')"}
    if($calls -match '/v1/test/only'){throw 'Test code counted'}
    if(@($s.listens)[0].resolved -ne 'case-created' -or @($s.sends)[0].topic -ne 'case-done'){throw "Kafka: $($s.listens|ConvertTo-Json -Compress) $($s.sends|ConvertTo-Json -Compress)"}
    Write-Host 'PASS: API surface (controller paths with class prefix, Feign and config calls, Kafka listen/send with property topics, tests skipped)'
}finally{ if(Test-Path -LiteralPath $base){Remove-Item -LiteralPath $base -Recurse -Force} }
