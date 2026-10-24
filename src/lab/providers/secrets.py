import base64
import os
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from lab.config import settings

def cipher():
    key = base64.b64decode(settings().secrets_master_key, validate=True)
    if len(key) != 32: raise ValueError("MASTER_KEY_MUST_BE_32_BYTES")
    return AESGCM(key)

def encrypt(key, workspace, provider):
    if not key.strip(): raise ValueError("EMPTY_PROVIDER_KEY")
    nonce = os.urandom(12)
    body = cipher().encrypt(nonce, key.strip().encode(), (str(workspace) + ":" + provider + ":v1").encode())
    return body, nonce

def decrypt(row):
    return cipher().decrypt(bytes(row["nonce"]), bytes(row["ciphertext"]),
        (str(row["workspace_id"]) + ":" + row["provider"] + ":v1").encode()).decode()

