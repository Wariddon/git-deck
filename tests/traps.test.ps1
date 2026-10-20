$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
. (Join-Path $root 'lib\GitDeck.Traps.ps1')
$patch=@'
commit:abc1234
diff --git a/src/main/java/a/Proxy.java b/src/main/java/a/Proxy.java
--- a/src/main/java/a/Proxy.java
+++ b/src/main/java/a/Proxy.java
@@ -10,0 +11,2 @@
+    headers.set("Content-Length", incoming.getHeader("Content-Length"));
+    private boolean isActive;
diff --git a/pom.xml b/pom.xml
--- a/pom.xml
+++ b/pom.xml
@@ -40 +40 @@
-      <scope>compile</scope>
+      <scope>provided</scope>
diff --git a/src/main/resources/application-uat.yml b/src/main/resources/application-uat.yml
--- a/src/main/resources/application-uat.yml
+++ b/src/main/resources/application-uat.yml
@@ -3,0 +4,2 @@
+  redis:
+    host: classic
diff --git a/src/test/java/a/ProxyTest.java b/src/test/java/a/ProxyTest.java
--- a/src/test/java/a/ProxyTest.java
+++ b/src/test/java/a/ProxyTest.java
@@ -5,0 +6 @@
+  @MockBean Client client;
diff --git a/src/main/resources/application.yml b/src/main/resources/application.yml
--- a/src/main/resources/application.yml
+++ b/src/main/resources/application.yml
@@ -1,0 +2 @@
+  url: http://localhost:8080/api
'@
$found=@(Find-GitDeckKnownTraps $patch)
$byId=@{};foreach($f in $found){$byId[$f.id]=$f}
foreach($id in @('content-length','lombok-boolean-is','provided-scope','env-profile','mockbean','localhost-url')){ if(-not $byId.ContainsKey($id)){throw "Missed $id"} }
if((@($byId['content-length'].places) -join ',') -ne 'src/main/java/a/Proxy.java:11'){throw "Line wrong: $(@($byId['content-length'].places) -join ',')"}
if((@($byId['lombok-boolean-is'].places) -join ',') -ne 'src/main/java/a/Proxy.java:12'){throw 'Second line number wrong'}
if((@($byId['env-profile'].places) -join ',') -ne 'src/main/resources/application-uat.yml:4'){throw 'Profile listed once per file'}
if(@(Find-GitDeckKnownTraps "+++ b/README.md`n@@ -1 +1 @@`n+Set Content-Length header in docs").Count){throw 'README is not code'}
Write-Host 'PASS: known traps in added lines (Content-Length, provided scope, Lombok isX, env profile, @MockBean, localhost) with file:line'
