#!/usr/bin/env python3
"""
构建前生成固定的签名 keystore。
debug 构建默认用 ~/.android/debug.keystore，CI 每次都是全新的随机密钥，
所以每次产出的 APK 签名都不同、无法覆盖安装。
这里用仓库里固定的 cert/key 生成 jiansu.keystore，让签名永远一致。
"""
import subprocess
import sys
import pathlib

KEYSTORE = "native/keystore/jiansu.keystore"
STORE_PASS = "jiansu2026"
KEY_ALIAS = "jiansu"


def main() -> int:
    p = pathlib.Path(KEYSTORE)
    if p.exists():
        p.unlink()

    cmd = [
        "keytool", "-genkeypair",
        "-keystore", KEYSTORE,
        "-storetype", "PKCS12",
        "-storepass", STORE_PASS,
        "-keypass", STORE_PASS,
        "-alias", KEY_ALIAS,
        "-keyalg", "RSA",
        "-keysize", "2048",
        "-validity", "10000",
        "-dname", "CN=JianSu, O=JianSu, C=CN",
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout, r.stderr, file=sys.stderr)
        return r.returncode

    print("keystore ready:", KEYSTORE)
    return 0


if __name__ == "__main__":
    sys.exit(main())
