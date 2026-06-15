import json
import sys
import time
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
            parsed = json.loads(raw) if raw else None
            return resp.status, parsed
    except error.HTTPError as e:
        raw = e.read().decode('utf-8')
        parsed = json.loads(raw) if raw else None
        return e.code, parsed


def expect(condition, message):
    if not condition:
        raise AssertionError(message)


def login(username, password):
    status, data = api('POST', '/auth/login', {'username': username, 'password': password})
    expect(status == 200 and 'token' in data, f'login failed for {username}: {status} {data}')
    return data['token'], data['user']


def main():
    result = {'checks': []}

    admin_token, _ = login('admin', 'admin123')
    business_token, _ = login('business1', 'biz123')
    legal_token, _ = login('legal1', 'legal123')

    status, contract = api('POST', '/contracts', {
        'name': f'codex-review-{int(time.time())}',
        'description': 'reviewer generated contract for solo recheck'
    }, admin_token)
    expect(status == 201, f'create contract failed: {status} {contract}')
    contract_id = contract['id']
    result['contract_id'] = contract_id

    clauses_payload = {
        'clauses': [
            {'clause_number': '1', 'title': '付款条款', 'content': '甲方应在收到发票后30日内付款。', 'risk_level': 'medium'},
            {'clause_number': '2', 'title': '保密条款', 'content': '双方应对商业秘密承担保密义务。', 'risk_level': 'high'}
        ]
    }
    status, imported = api('POST', f'/contracts/{contract_id}/import', clauses_payload, admin_token)
    expect(status == 200 and imported['imported_count'] == 2, f'import failed: {status} {imported}')
    result['checks'].append('create contract + import clauses')

    status, clauses = api('GET', f'/clauses?contract_id={contract_id}', token=admin_token)
    expect(status == 200 and len(clauses) == 2, f'list clauses failed: {status} {clauses}')
    clause1 = next(c for c in clauses if c['clause_number'] == '1')
    clause2 = next(c for c in clauses if c['clause_number'] == '2')

    draft_payload = {
        'type': 'comment',
        'content': '建议补充逾期付款违约责任说明。',
        'base_version': 1,
        'exclusive_role': 'all'
    }
    status, saved_draft = api('POST', f'/clauses/{clause1["id"]}/drafts', draft_payload, business_token)
    expect(status == 200 and saved_draft['base_version'] == 1, f'save draft failed: {status} {saved_draft}')

    status, restored = api('POST', f'/clauses/{clause1["id"]}/drafts/restore', {}, business_token)
    expect(status == 200 and restored['content'] == draft_payload['content'], f'restore failed: {status} {restored}')
    expect(restored['version_conflict'] is False, 'restore should not conflict before version change')
    result['checks'].append('success path: save draft + restore without conflict')

    status, legal_view = api('GET', f'/clauses/{clause1["id"]}/drafts', token=legal_token)
    expect(status == 200 and legal_view is None, f'role isolation failed: {status} {legal_view}')
    status, legal_restore = api('POST', f'/clauses/{clause1["id"]}/drafts/restore', {}, legal_token)
    expect(status == 404, f'other role should not restore another user draft: {status} {legal_restore}')
    result['checks'].append('permission isolation: another role cannot read current user draft')

    amend_payload = {
        'type': 'amendment',
        'content': '将付款时限改为15日并增加违约金。',
        'base_version': 1,
        'amended_content': '甲方应在收到发票后15日内付款，逾期按日万分之五承担违约责任。',
        'exclusive_role': 'all'
    }
    status, suggestion_resp = api('POST', f'/clauses/{clause1["id"]}/suggestions', amend_payload, admin_token)
    expect(status == 201, f'create amendment failed: {status} {suggestion_resp}')
    suggestion_id = suggestion_resp['suggestion']['id']
    status, merge_resp = api('POST', f'/clauses/{clause1["id"]}/suggestions/{suggestion_id}/merge', {'reason': '升级条款版本用于复核恢复冲突'}, admin_token)
    expect(status == 200 and merge_resp['new_version'] == 2, f'merge failed: {status} {merge_resp}')

    status, conflict_draft = api('GET', f'/clauses/{clause1["id"]}/drafts', token=business_token)
    expect(status == 200 and conflict_draft['version_conflict'] is True, f'expected conflict draft: {status} {conflict_draft}')
    expect(conflict_draft['current_version'] == 2, 'conflict draft current_version should be 2')
    expect(conflict_draft['conflict_detail']['newer_versions'][0]['version_number'] == 2, 'conflict detail should contain v2')
    result['checks'].append('boundary path: conflict detected after clause version changes')

    status, continue_resp = api('POST', f'/clauses/{clause1["id"]}/drafts/conflict-action', {'action': 'continue'}, business_token)
    expect(status == 200 and continue_resp['action'] == 'continue', f'continue action failed: {status} {continue_resp}')

    status, copy_resp = api('POST', f'/clauses/{clause1["id"]}/drafts/conflict-action', {'action': 'copy'}, business_token)
    expect(status == 200 and copy_resp['base_version'] == 2 and copy_resp['version_conflict'] is False, f'copy action failed: {status} {copy_resp}')

    status, bad_action = api('POST', f'/clauses/{clause1["id"]}/drafts/conflict-action', {'action': 'invalid'}, business_token)
    expect(status == 400, f'invalid conflict action should fail 400: {status} {bad_action}')
    result['checks'].append('failure path: invalid conflict action returns 400')

    status, missing_restore = api('POST', f'/clauses/{clause2["id"]}/drafts/restore', {}, business_token)
    expect(status == 404, f'restore missing draft should 404: {status} {missing_restore}')
    result['checks'].append('failure path: restoring non-existent draft returns 404')

    status, clause2_draft = api('POST', f'/clauses/{clause2["id"]}/drafts', {
        'type': 'comment',
        'content': '这是一条待丢弃的草稿。',
        'base_version': 1,
        'exclusive_role': 'all'
    }, business_token)
    expect(status == 200, f'clause2 save draft failed: {status} {clause2_draft}')
    status, discard_resp = api('POST', f'/clauses/{clause2["id"]}/drafts/conflict-action', {'action': 'discard'}, business_token)
    expect(status == 200 and discard_resp['action'] == 'discard', f'discard action failed: {status} {discard_resp}')

    status, submit_seed = api('POST', f'/clauses/{clause2["id"]}/drafts', {
        'type': 'comment',
        'content': '提交前草稿内容。',
        'base_version': 1,
        'exclusive_role': 'all'
    }, business_token)
    expect(status == 200, f'clause2 save draft for submit failed: {status} {submit_seed}')
    status, submitted = api('POST', f'/clauses/{clause2["id"]}/suggestions', {
        'type': 'comment',
        'content': '正式提交的评审建议。',
        'base_version': 1,
        'exclusive_role': 'all'
    }, business_token)
    expect(status == 201, f'create suggestion from draft failed: {status} {submitted}')

    status, clause2_after_submit = api('GET', f'/clauses/{clause2["id"]}/drafts', token=business_token)
    expect(status == 200 and clause2_after_submit is None, f'draft should be cleared after submit: {status} {clause2_after_submit}')
    result['checks'].append('audit path: discard and submit clear draft as expected')

    status, restart_seed = api('POST', f'/clauses/{clause2["id"]}/drafts', {
        'type': 'comment',
        'content': '重启后应能恢复的草稿。',
        'base_version': 1,
        'exclusive_role': 'all'
    }, business_token)
    expect(status == 200, f'restart seed draft failed: {status} {restart_seed}')
    result['restart_check'] = {
        'clause_id': clause2['id'],
        'expected_content': '重启后应能恢复的草稿。'
    }

    status, export_data = api('GET', f'/reports/contract/{contract_id}/export', token=admin_token)
    expect(status == 200, f'export failed: {status} {export_data}')
    draft_actions = [log['action'] for log in export_data['audit_logs'] if log['entity_type'] == 'draft']
    expect('restore_draft' in draft_actions, f'export missing restore_draft audit: {draft_actions}')
    expect('draft_conflict_continue' in draft_actions, f'export missing draft_conflict_continue audit: {draft_actions}')
    expect('draft_conflict_copy' in draft_actions, f'export missing draft_conflict_copy audit: {draft_actions}')
    expect('draft_conflict_discard' in draft_actions, f'export missing draft_conflict_discard audit: {draft_actions}')
    expect('submit_draft' in draft_actions, f'export missing submit_draft audit: {draft_actions}')
    result['checks'].append('export includes draft restore/conflict audit logs')

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
