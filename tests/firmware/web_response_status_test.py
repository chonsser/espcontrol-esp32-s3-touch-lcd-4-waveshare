"""Compile the production status map so endpoint codes never collapse into 500."""
from pathlib import Path
import os
import re
import shlex
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
source = (ROOT / "components/web_server_idf/web_server_idf.cpp").read_text()
start = source.index("const char *status;", source.index("void AsyncWebServerRequest::init_response_("))
switch = source[start:source.index("\n  }\n", start) + len("\n  }\n")]

# Every status the panel endpoints hand to request->send() must survive the map.
emitted = {200}
for path in sorted((ROOT / "components/espcontrol").glob("*.h")):
    text = path.read_text()
    emitted.update(int(code) for code in re.findall(r"request->send\((\d{3})", text))
    emitted.update(int(code) for code in re.findall(r"\bhttp_status\s*\{\s*(\d{3})", text))
    emitted.update(int(code) for code in re.findall(r"ScreenOptionsStatus::\w+,\s*\{\},\s*(\d{3})\}", text))
assert {400, 429, 503} <= emitted, f"expected the options endpoint codes, found {sorted(emitted)}"

expected = {
    200: "200 OK",
    400: "400 Bad Request",
    404: "404 Not Found",
    409: "409 Conflict",
    429: "429 Too Many Requests",
    503: "503 Service Unavailable",
}
checks = "".join(
    f'  assert(std::strcmp(map_status({code}), "{line}") == 0);\n'
    for code, line in sorted(expected.items())
)
# Codes the firmware emits must map to themselves, not to the 500 fallback.
checks += "".join(
    f"  assert(std::strncmp(map_status({code}), \"{code}\", 3) == 0);\n" for code in sorted(emitted)
)

harness = r'''
#include <cassert>
#include <cstring>
#define HTTPD_200 "200 OK"
#define HTTPD_400 "400 Bad Request"
#define HTTPD_404 "404 Not Found"
#define HTTPD_500 "500 Internal Server Error"
''' + source[source.index("#ifndef HTTPD_409"):source.index("#define CRLF_STR")] + r'''
static const char *map_status(int code) {
''' + switch + r'''
  return status;
}
int main() {
''' + checks + r'''  assert(std::strcmp(map_status(418), "500 Internal Server Error") == 0);
}
'''

with tempfile.TemporaryDirectory(prefix="web-response-status-") as tmp:
    cpp = Path(tmp) / "test.cpp"
    cpp.write_text(harness)
    binary = Path(tmp) / "test"
    command = shlex.split(os.environ.get("CXX", "c++"))
    command += ["-std=c++20", "-Wall", "-Wextra", "-Werror"]
    subprocess.run(command + [str(cpp), "-o", str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
print(f"Web response status map covers {sorted(emitted)}.")
