# Yume Restaurant System (Digital Menu + POS)

**Author:** A.K.A Technology – Ajaya Kandel  
**Restaurant:** Asian Dining 夢 錦糸町

This repository contains the full backend and frontend code for the **Digital Menu & Counter POS system** built on **Google Apps Script + Google Sheets**.

The system is designed for real restaurant use in Japan:
- Multi-screen: **Menu, Kitchen, Bar, Counter, Staff**
- Runs on **Android tablets, iPads, iPhones, PCs**
- Uses **Google Sheets** as a simple database
- Easy to backup and move to another Gmail account

---

## Features

### Customer Menu (menu.html)
- Beautiful digital menu with categories (All / Lunch / Thai / Naan & Side / Dinner Curry etc.)
- 2-column responsive cards (optimized for Android tablet & iPhone)
- Cart bar with **Add / − / +** controls
- Sends orders to Google Apps Script backend

### Kitchen & Bar Displays
- **kitchen.html**: Shows only food orders (no drinks)
- **bar.html**: Shows all drinks & set drinks
- Auto refresh every few seconds
- Clear layout for busy restaurant operation

### Counter POS (counter.html)
- Reads orders from **“Counter Display”** sheet
- Shows **unpaid & paid** orders
- Checkout screen:
  - Discount by **yen** or **percent**
  - Payment methods: cash / card / QR etc.
- Writes full history into **“Payment History”** sheet
- Marks counter rows as `"paid"`

### Payment History & Reports
- **Payment History** sheet stores:
  - Original price, discount, final price
  - Payment method, reference number, staff, paid time
- Automatic **Reference Number**: `YYMMDD-XXXX`
- Built-in **Daily / Range reports**:
  - Orders count
  - Items total
  - Gross / Discount / Net
- Reprint system:
  - Search by date range / keyword / reference number
  - Returns data for reprinting receipts

---

## Project Structure

```text
backend/
  Config.gs   → Sheet names, staff list, global settings
  Utils.gs    → Shared helper functions (date, numbers, JSON output)
  Main.gs     → doGet / doPost, HTML routing, login
  Orders.gs   → handleMenuOrder_, getCounterData, checkoutOrders, etc.
  Reports.gs  → buildReportSummary_, daily & range report, reprint system

frontend/
  menu.html      → Customer menu UI
  kitchen.html   → Kitchen display UI
  bar.html       → Bar display UI
  counter.html   → Counter POS UI
  staff.html     → (Optional) staff / login view

docs/
  screenshots/   → Optional UI screenshots for documentation
