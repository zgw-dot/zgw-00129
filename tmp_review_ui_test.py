import json
import sys
import time
from urllib import request

from playwright.sync_api import sync_playwright, expect

BASE_API = 'http://127.0.0.1:3001/api'
BASE_WEB = 'http://127.0.0.1:8080'


def api(method, path, data=None, token=None):
    body = None
    headers = {'Accept': 'application/json'}
    if data is not None:
        body = json.dumps(data).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    if token:
        headers['Authorization'] = f'Bearer {token}'
    req = request.Request(BASE_API + path, data=body, headers=headers, method=method)
    with request.urlopen(req, timeout=20) as resp:
        return resp.status, json.loads(resp.read().decode('utf-8'))


def login_api(username, password):
    status, data = api('POST', '/auth/login', {'username': username, 'password': password})
    if status != 200:
        raise RuntimeError(f'api login failed: {status}')
    return data['token']


def setup_contract():
    admin = login_api('admin', 'admin123')
    business = login_api('business1', 'biz123')
    status, contract = api('POST', '/contracts', {
        'name': f'ui-review-{int(time.time())}',
        'description': 'ui validation contract'
    }, admin)
    assert status == 201
    contract_id = contract['id']
    status, _ = api('POST', f'/contracts/{contract_id}/import', {
        'clauses': [
            {'clause_number': '1', 'title': '交付条款', 'content': '乙方应在五个工作日内完成交付。', 'risk_level': 'medium'}
        ]
    }, admin)
    assert status == 200
    status, clauses = api('GET', f'/clauses?contract_id={contract_id}', token=admin)
    clause = clauses[0]
    status, _ = api('POST', f'/clauses/{clause["id"]}/drafts', {
        'type': 'comment',
        'content': '请补充交付延期责任。',
        'base_version': 1,
        'exclusive_role': 'all'
    }, business)
    assert status == 200
    return {'contract_id': contract_id, 'clause_id': clause['id'], 'admin': admin, 'business': business}


def upgrade_version(clause_id, admin_token):
    status, suggestion = api('POST', f'/clauses/{clause_id}/suggestions', {
        'type': 'amendment',
        'content': '把交付时间改为三个工作日。',
        'base_version': 1,
        'amended_content': '乙方应在三个工作日内完成交付。',
        'exclusive_role': 'all'
    }, admin_token)
    assert status == 201
    suggestion_id = suggestion['suggestion']['id']
    status, _ = api('POST', f'/clauses/{clause_id}/suggestions/{suggestion_id}/merge', {
        'reason': '制造版本变化验证冲突恢复'
    }, admin_token)
    assert status == 200


def fill_login(page, username, password):
    page.goto(f'{BASE_WEB}/login', wait_until='networkidle')
    page.get_by_placeholder('用户名').fill(username)
    page.get_by_placeholder('密码').fill(password)
    page.get_by_role('button', name='登 录').click()
    page.wait_for_load_state('networkidle')


def open_clause(page, contract_name, clause_title):
    page.locator('a', has_text=contract_name).first.click()
    page.wait_for_load_state('networkidle')
    page.locator('a', has_text=clause_title).first.click()
    page.wait_for_load_state('networkidle')


def main():
    setup = setup_contract()
    out = {'checks': []}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1440, 'height': 1100})

        fill_login(page, 'business1', 'biz123')
        contract_name = page.locator('a').filter(has_text='ui-review-').first.inner_text().strip()
        page.wait_for_timeout(500)
        open_clause(page, contract_name, '交付条款')

        alert = page.locator('.ant-alert').first
        expect(alert).to_be_visible(timeout=10000)
        expect(alert.get_by_text('发现您上次未完成的编辑')).to_be_visible(timeout=10000)
        expect(alert.get_by_text('最近保存时间')).to_be_visible(timeout=10000)
        expect(alert.get_by_text('草稿基于版本')).to_be_visible(timeout=10000)

        page.get_by_role('button', name='一键继续编辑').click()
        expect(page.get_by_role('dialog', name='发起评审建议')).to_be_visible(timeout=10000)
        expect(page.locator("textarea").filter(has_text='')).to_have_value('请补充交付延期责任。', timeout=10000)
        expect(page.get_by_text('从草稿恢复')).to_be_visible(timeout=10000)
        out['checks'].append('UI success path: restore banner opens editor modal directly with saved draft content')

        page.get_by_label('关闭', exact=False).last.click()
        page.wait_for_timeout(500)

        page.get_by_text('业务-王芳').click()
        page.get_by_text('退出登录').click()
        page.wait_for_load_state('networkidle')
        fill_login(page, 'business1', 'biz123')
        open_clause(page, contract_name, '交付条款')
        expect(page.get_by_text('发现您上次未完成的编辑')).to_be_visible(timeout=10000)
        out['checks'].append('UI state persistence: same user can restore after logout/login')

        upgrade_version(setup['clause_id'], setup['admin'])
        page.reload(wait_until='networkidle')
        expect(page.get_by_text('上次编辑的草稿存在版本变化')).to_be_visible(timeout=10000)
        expect(page.get_by_text('查看草稿保存时的条款内容')).to_be_visible(timeout=10000)
        page.get_by_role('button', name='查看旧内容').click()
        expect(page.get_by_role('dialog', name='草稿保存时的条款内容快照')).to_be_visible(timeout=10000)
        out['checks'].append('UI conflict path: version change shows conflict banner and old snapshot entry')

        browser.close()

    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
