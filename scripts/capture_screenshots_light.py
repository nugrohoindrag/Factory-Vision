import os
import time
from playwright.sync_api import sync_playwright

SCREENSHOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "Docs", "screenshots"))
os.makedirs(SCREENSHOT_DIR, exist_ok=True)

def capture_light_screenshots():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Desktop 1920x1080 with 2x scale for ultra-crisp presentation display
        context = browser.new_context(
            viewport={'width': 1920, 'height': 1080},
            device_scale_factor=1.5
        )
        page = context.new_page()

        print("Navigating to Console Login http://localhost:3100 ...")
        page.goto("http://localhost:3100", wait_until="domcontentloaded")
        time.sleep(1)

        # Login to console
        try:
            page.wait_for_selector('#fv-email', timeout=10000)
            print("Logging in to console with admin@pabrik.co.id ...")
            page.fill('#fv-email', 'admin@pabrik.co.id')
            page.fill('#fv-password', os.environ.get('BOOTSTRAP_ADMIN_PASSWORD', 'ChangeMe-Local-Only'))
            page.click('button[type="submit"]')
            page.wait_for_load_state("domcontentloaded")
            time.sleep(2)
        except Exception as e:
            print(f"Login failed or already logged in: {e}")

        # Enforce Light Mode
        print("Enforcing Light Theme across all views...")
        page.evaluate("""() => {
            localStorage.setItem('fv_theme_mode', 'light');
            document.documentElement.setAttribute('data-theme', 'light');
            document.body.classList.remove('morphic-theme-dark');
            document.body.classList.add('morphic-theme-light');
        }""")
        time.sleep(1)

        # Route definitions
        routes = [
            ("01-executive-dashboard.png", "http://localhost:3100/"),
            ("02-production-performance.png", "http://localhost:3100/target-vs-actual"),
            ("03-oee.png", "http://localhost:3100/oee"),
            ("04-downtime.png", "http://localhost:3100/downtime-analytics"),
            ("05-work-orders.png", "http://localhost:3100/work-orders"),
            ("06-live-board.png", "http://localhost:3100/live-board"),
            ("07-shift-handover.png", "http://localhost:3100/shift-handover"),
            ("08-bottlenecks.png", "http://localhost:3100/bottlenecks"),
            ("09-reports-production.png", "http://localhost:3100/reports?tab=production"),
            ("10-reports-downtime.png", "http://localhost:3100/reports?tab=downtime"),
            ("11-reports-oee.png", "http://localhost:3100/reports?tab=oee"),
            ("12-audit-logs.png", "http://localhost:3100/audit-logs"),
            ("13-master-machines.png", "http://localhost:3100/settings?tab=machines"),
            ("14-master-lines.png", "http://localhost:3100/settings?tab=lines"),
            ("15-master-products.png", "http://localhost:3100/settings?tab=products"),
            ("16-master-processes.png", "http://localhost:3100/settings?tab=processes"),
            ("17-master-roles.png", "http://localhost:3100/settings?tab=roles"),
            ("18-master-acl.png", "http://localhost:3100/settings?tab=acl"),
            ("19-master-shifts.png", "http://localhost:3100/settings?tab=shifts")
        ]

        for filename, url in routes:
            print(f"Capturing [LIGHT MODE] {filename} from {url} ...")
            try:
                page.goto(url, wait_until="domcontentloaded")
                # Force light theme on each navigation
                page.evaluate("""() => {
                    localStorage.setItem('fv_theme_mode', 'light');
                    document.documentElement.setAttribute('data-theme', 'light');
                    document.body.classList.remove('morphic-theme-dark');
                    document.body.classList.add('morphic-theme-light');
                }""")
                time.sleep(1.5)
                out_path = os.path.join(SCREENSHOT_DIR, filename)
                page.screenshot(path=out_path, full_page=False)
                print(f"Saved: {out_path}")
            except Exception as e:
                print(f"Failed to capture {url}: {e}")

        # Now Capture Operator Terminal in Light Mode
        print("Navigating to Operator App http://localhost:3200 ...")
        op_page = context.new_page()
        try:
            op_page.goto("http://localhost:3200", wait_until="domcontentloaded")
            time.sleep(1)
            
            # Check for employee number input
            emp_input = op_page.locator('input[placeholder*="OP-"], input[type="text"]')
            if emp_input.count() > 0:
                emp_input.first.fill('OP-1001')
                time.sleep(0.5)

            # Click digits 1, 2, 3, 4 on the numeric pad if present
            for digit in ["1", "2", "3", "4"]:
                btn = op_page.locator(f'button:has-text("{digit}")').first
                if btn.count() > 0:
                    btn.click()
                    time.sleep(0.2)

            # Click submit button
            submit_btn = op_page.locator('button:has-text("Masuk"), button:has-text("Login"), button[type="submit"]')
            if submit_btn.count() > 0:
                submit_btn.first.click()
                time.sleep(2)

            # Take screenshot of Operator Terminal
            out_path_op = os.path.join(SCREENSHOT_DIR, "20-operator-terminal.png")
            op_page.screenshot(path=out_path_op, full_page=False)
            print(f"Saved: {out_path_op}")
        except Exception as e:
            print(f"Failed to capture Operator App: {e}")

        browser.close()
        print("All Light Mode screenshots successfully captured!")

if __name__ == "__main__":
    capture_light_screenshots()
