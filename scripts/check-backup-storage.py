"""Read-only Spaces protection check. No object contents or credentials are printed.

Supply DO_SPACES_KEY and DO_SPACES_SECRET through the process environment.
Uses only GET requests for bucket versioning and lifecycle configuration.
"""
import datetime
import hashlib
import hmac
import json
import os
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET


def inspect_setting(setting):
    key = os.environ['DO_SPACES_KEY']
    secret = os.environ['DO_SPACES_SECRET']
    region = 'lon1'
    host = 'familytrack.lon1.digitaloceanspaces.com'
    now = datetime.datetime.now(datetime.timezone.utc)
    stamp = now.strftime('%Y%m%dT%H%M%SZ')
    day = now.strftime('%Y%m%d')
    digest = hashlib.sha256(b'').hexdigest()
    headers = f'host:{host}\nx-amz-content-sha256:{digest}\nx-amz-date:{stamp}\n'
    signed = 'host;x-amz-content-sha256;x-amz-date'
    canonical = f'GET\n/\n{setting}=\n{headers}\n{signed}\n{digest}'
    scope = f'{day}/{region}/s3/aws4_request'
    message = f'AWS4-HMAC-SHA256\n{stamp}\n{scope}\n{hashlib.sha256(canonical.encode()).hexdigest()}'
    signing = ('AWS4' + secret).encode()
    for part in (day, region, 's3', 'aws4_request'):
        signing = hmac.new(signing, part.encode(), hashlib.sha256).digest()
    signature = hmac.new(signing, message.encode(), hashlib.sha256).hexdigest()
    request = urllib.request.Request(f'https://{host}/?{setting}=', headers={
        'x-amz-date': stamp, 'x-amz-content-sha256': digest,
        'Authorization': f'AWS4-HMAC-SHA256 Credential={key}/{scope}, SignedHeaders={signed}, Signature={signature}',
    })
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            root = ET.fromstring(response.read())
        if setting == 'versioning':
            return {'status': root.findtext('{*}Status') or 'Disabled'}
        return {'rules': [
            {'status': rule.findtext('{*}Status'),
             'noncurrentExpiryDays': rule.findtext('{*}NoncurrentVersionExpiration/{*}NoncurrentDays'),
             'currentExpiryDays': rule.findtext('{*}Expiration/{*}Days')}
            for rule in root.findall('{*}Rule')]}
    except urllib.error.HTTPError as error:
        return {'status': 'unverified', 'httpStatus': error.code}


if __name__ == '__main__':
    if not all(os.environ.get(name) for name in ('DO_SPACES_KEY', 'DO_SPACES_SECRET')):
        raise SystemExit('Missing Spaces credentials. Supply them securely through environment variables; do not paste them into chat.')
    try:
        print(json.dumps({'bucket': 'familytrack', 'versioning': inspect_setting('versioning'),
                          'lifecycle': inspect_setting('lifecycle')}, indent=2))
    except Exception as error:
        raise SystemExit(f'Backup configuration check failed ({type(error).__name__}); no settings changed.')
