import os
import time
from playwright.sync_api import sync_playwright

SCREENSHOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "Docs", "screenshots"))
os.makedirs(SCREENSHOT_DIR, exist_ok=True)

def capture_all():
    with sync_playwright() as p:
        # Launch chromium in headless mode with 1920x1080 resolution
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={'width': 1920, 'height': 1080},
            device_scale_factor=1.5
        )
        page = context.new_page()

        print("Navigating to Console Login http://localhost:3100 ...")
        page.goto("http://localhost:3100", wait_until="networkidle")
        time.sleep(1)

        # Check if login form is present
        email_input = page.locator('#fv-email')
        if email_input.count() > 0:
            print("Logging in with admin@pabrik.co.id ...")
            page.fill('#fv-email', 'admin@pabrik.co.id')
            page.fill('#fv-password', os.environ.get('BOOTSTRAP_ADMIN_PASSWORD', 'ChangeMe-Local-Only'))
            page.click('button[type="submit"]')
            page.wait_for_load_state("networkidle")
            time.sleep(2)
        
        # Define routes to capture
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
            print(f"Capturing {filename} from {url} ...")
            try:
                page.goto(url, wait_until="networkidle")
                time.sleep(1.5)
                # Ensure theme or animations are settled
                out_path = os.path.join(SCREENSHOT_DIR, filename)
                page.screenshot(path=out_path, full_page=False)
                print(f"Saved: {out_path}")
            except Exception as e:
                print(f"Failed to capture {url}: {e}")

        # Now capture Operator Terminal (port 3200)
        print("Navigating to Operator App http://localhost:3200 ...")
        try:
            page.goto("http://localhost:3200", wait_until="networkidle")
            time.sleep(1.5)
            # Check for operator login if needed
            pin_input = page.locator('input')
            out_path_op = os.path.join(SCREENSHOT_DIR, "20-operator-terminal.png")
            page.screenshot(path=out_path_op, full_page=False)
            print(f"Saved: {out_path_op}")
        except Exception as e:
            print(f"Failed to capture Operator App: {e}")

        browser.close()
        print("All screenshots successfully captured!")

if __name__ == "__main__":
    capture_all()
