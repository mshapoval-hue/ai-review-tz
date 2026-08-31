$ErrorActionPreference = "Stop"

$Port = 8765
$AllowedOrigin = "https://mshapoval-hue.github.io"
$Listener = New-Object System.Net.HttpListener
$Listener.Prefixes.Add("http://127.0.0.1:$Port/")

function Add-CorsHeaders($response) {
    $response.Headers["Access-Control-Allow-Origin"] = $AllowedOrigin
    $response.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    $response.Headers["Access-Control-Allow-Headers"] = "Content-Type"
    $response.Headers["Access-Control-Max-Age"] = "86400"
}

function Send-Json($context, $statusCode, $data) {
    $json = $data | ConvertTo-Json -Depth 20
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $context.Response.StatusCode = $statusCode
    $context.Response.ContentType = "application/json; charset=utf-8"
    Add-CorsHeaders $context.Response
    $context.Response.ContentLength64 = $bytes.Length
    $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $context.Response.OutputStream.Close()
}

function Read-RequestBody($request) {
    $reader = New-Object System.IO.StreamReader($request.InputStream, $request.ContentEncoding)
    try { return $reader.ReadToEnd() } finally { $reader.Close() }
}

function New-HttpClient {
    $handler = New-Object System.Net.Http.HttpClientHandler
    $handler.UseDefaultCredentials = $true
    $handler.PreAuthenticate = $true
    return New-Object System.Net.Http.HttpClient($handler)
}

function Upload-File($client, $baseUrl, $projectId, $sessionId, $fileName, $fileBytes) {
    $url = "$baseUrl/api/v1/files/$sessionId/upload/?project_id=$projectId"

    $content = New-Object System.Net.Http.MultipartFormDataContent
    $fileContent = New-Object System.Net.Http.ByteArrayContent -ArgumentList (,$fileBytes)
    $fileContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    $content.Add($fileContent, "file", $fileName)

    $response = $client.PostAsync($url, $content).GetAwaiter().GetResult()
    $text = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()

    if (-not $response.IsSuccessStatusCode) {
        throw "MWS upload error HTTP $([int]$response.StatusCode): $text"
    }

    return ($text | ConvertFrom-Json)
}

function Run-MwsReview($client, $config, $sessionId, $fileName, $bucket, $s3Path) {
    $projectId = [string]$config.projectId
    $versionId = [string]$config.projectVersionId
    $baseUrl = [string]$config.mwsBaseUrl
    $triggerText = if ($config.triggerText) { [string]$config.triggerText } else { "вот" }

    $payload = @{
        data = @{
            type = "engine"
            attributes = @{
                sessionId = $sessionId
                messageId = [string][DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
                debug = $false
                environmentId = $null
                streamEvents = @("toolCallsWithResults")
                uuid = @{
                    sub = [guid]::NewGuid().ToString()
                    userId = [guid]::NewGuid().ToString()
                }
                payload = @{
                    message = @{
                        originalText = $triggerText
                    }
                    contextOverride = @{
                        request = @{
                            files = @(
                                @{
                                    name = $fileName
                                    bucket = $bucket
                                    s3_path = $s3Path
                                }
                            )
                        }
                        session = @{}
                        system = @{
                            surface_metadata = @{}
                            input = @{}
                        }
                        temp = @{}
                    }
                }
            }
        }
    }

    $json = $payload | ConvertTo-Json -Depth 30 -Compress
    $content = New-Object System.Net.Http.StringContent(
        $json,
        [System.Text.Encoding]::UTF8,
        "application/json"
    )

    $url = "$baseUrl/api/v4/nocode/projects/$projectId/project-versions/$versionId/engine/stream/"
    $response = $client.PostAsync($url, $content).GetAwaiter().GetResult()
    $text = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()

    if (-not $response.IsSuccessStatusCode) {
        throw "MWS engine error HTTP $([int]$response.StatusCode): $text"
    }

    $answers = New-Object System.Collections.Generic.List[string]

    foreach ($line in ($text -split "`r?`n")) {
        $trimmed = $line.Trim()
        if (-not $trimmed.StartsWith("data:")) { continue }

        $eventText = $trimmed.Substring(5).Trim()
        if (-not $eventText) { continue }

        try {
            $event = $eventText | ConvertFrom-Json -Depth 30
        } catch {
            continue
        }

        if ($event.messageName -ne "ANSWER_TO_USER") { continue }

        foreach ($item in @($event.payload.items)) {
            $value = $item.bubble.value
            if ($value -is [string] -and $value.Trim()) {
                $answers.Add($value.Trim())
            }
        }
    }

    if ($answers.Count -eq 0) {
        throw "MWS завершил обработку, но ANSWER_TO_USER не найден."
    }

    return ($answers | Sort-Object Length -Descending | Select-Object -First 1)
}

try {
    Add-Type -AssemblyName System.Net.Http
    $Listener.Start()
} catch {
    Write-Host ""
    Write-Host "Не удалось запустить AI Review Bridge." -ForegroundColor Red
    Write-Host $_.Exception.Message
    Read-Host "Нажмите Enter"
    exit 1
}

Write-Host ""
Write-Host "AI Review Bridge запущен." -ForegroundColor Green
Write-Host "Адрес: http://127.0.0.1:$Port"
Write-Host "Это окно должно оставаться открытым во время проверки ТЗ."
Write-Host ""

$client = New-HttpClient

try {
    while ($Listener.IsListening) {
        $context = $Listener.GetContext()
        $request = $context.Request

        if ($request.HttpMethod -eq "OPTIONS") {
            $context.Response.StatusCode = 204
            Add-CorsHeaders $context.Response
            $context.Response.Close()
            continue
        }

        if ($request.Url.AbsolutePath -eq "/health" -and $request.HttpMethod -eq "GET") {
            Send-Json $context 200 @{
                ok = $true
                service = "AI Review Bridge"
                version = "1.0"
            }
            continue
        }

        if ($request.Url.AbsolutePath -ne "/review" -or $request.HttpMethod -ne "POST") {
            Send-Json $context 404 @{ ok = $false; error = "Not found" }
            continue
        }

        try {
            $body = Read-RequestBody $request
            $input = $body | ConvertFrom-Json

            if (-not $input.fileName -or -not $input.fileBase64) {
                throw "Файл не передан."
            }

            if (-not ([string]$input.fileName).ToLower().EndsWith(".docx")) {
                throw "Поддерживается только DOCX."
            }

            if (-not $input.configUrl) {
                throw "Не передан configUrl."
            }

            # На каждый запуск берём свежую конфигурацию.
            $configJson = $client.GetStringAsync([string]$input.configUrl).GetAwaiter().GetResult()
            $config = $configJson | ConvertFrom-Json

            $fileBytes = [Convert]::FromBase64String([string]$input.fileBase64)
            $sessionId = [guid]::NewGuid().ToString()

            Write-Host "Проверка: $($input.fileName)"
            Write-Host "MWS project/version: $($config.projectId)/$($config.projectVersionId)"

            $uploaded = Upload-File `
                $client `
                ([string]$config.mwsBaseUrl) `
                ([string]$config.projectId) `
                $sessionId `
                ([string]$input.fileName) `
                $fileBytes

            $s3Path = if ($uploaded.s3Path) { [string]$uploaded.s3Path } else { [string]$uploaded.s3_path }
            $bucket = [string]$uploaded.bucket
            $uploadedFileName = if ($uploaded.fileName) { [string]$uploaded.fileName } else { [string]$input.fileName }

            if (-not $s3Path -or -not $bucket) {
                throw "MWS не вернул s3Path/bucket."
            }

            $report = Run-MwsReview `
                $client `
                $config `
                $sessionId `
                $uploadedFileName `
                $bucket `
                $s3Path

            Write-Host "Готово." -ForegroundColor Green

            Send-Json $context 200 @{
                ok = $true
                report = $report
                projectId = $config.projectId
                projectVersionId = $config.projectVersionId
            }
        } catch {
            Write-Host "Ошибка: $($_.Exception.Message)" -ForegroundColor Red
            Send-Json $context 500 @{
                ok = $false
                error = $_.Exception.Message
            }
        }
    }
}
finally {
    $client.Dispose()
    $Listener.Stop()
    $Listener.Close()
}
