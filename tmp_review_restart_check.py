import json
import sys
from urllib import request, error

BASE = 'http://127.0.0.1:3001/api'


def api(method, path, data=None, token=None, timeout=20):
    body = None
    headers = {'Accept': 'application/json'}
    if data is not None:
        body = json.dumps(data).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    if token:
        headers['Authorization'] = f'Bearer {token}'
    req = request.Request(BASE + path, data=body, headers=headers, method=method)
    try:
        with request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode('utf-8')
            return resp.status, json.loads(raw) if raw else None
    except error.HTTPError as e:
        raw = e.read().decode('utf-8')
        return e.code, json.loads(raw) if raw else None


def login(username, password):
    status, data = api('POST', '/auth/login', {'username': username, 'password': password})
    if status != 200:
        raise RuntimeError(f'login failed: {status} {data}')
    return data['token']


def main(meta_path):
    with open(meta_path, 'r', encoding='utf-8') as fh:
        meta = json.load(fh)
    token = login('business1', 'biz123')
    clause_id = meta['restart_check']['clause_id']
    expected = meta['restart_check']['expected_content']
    status, draft = api('GET', f'/clauses/{clause_id}/drafts', token=token)
    if status != 200 or not draft:
        raise RuntimeError(f'post-restart draft missing: {status} {draft}')
    if draft.get('content') != expected:
        raise RuntimeError(f'post-restart draft content mismatch: {draft}')
    print(json.dumps({'check': 'post restart restore draft still readable', 'draft_id': draft['id']}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        if len(sys.argv) != 2:
            raise RuntimeError('usage: python tmp_review_restart_check.py <meta_json_path>')
        main(sys.argv[1])
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
