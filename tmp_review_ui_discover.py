from playwright.sync_api import sync_playwright


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1440, 'height': 1100})
        page.goto('http://127.0.0.1:8080/login', wait_until='networkidle')
        page.get_by_placeholder('用户名').fill('business1')
        page.get_by_placeholder('密码').fill('biz123')
        page.get_by_role('button', name='登 录').click()
        page.wait_for_load_state('networkidle')
        print('TITLE:', page.title())
        print('URL:', page.url)
        print('LINKS:')
        for link in page.locator('a').all_inner_texts():
            print(repr(link))
        page.screenshot(path='tmp_review_contracts.png', full_page=True)
        browser.close()


if __name__ == '__main__':
    main()
