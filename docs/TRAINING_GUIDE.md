# Easy Sales Export Platform: The Ultimate Training & Walkthrough Guide
*Written in simple, clear language so that anyone—even a 7-year-old—can understand and use the entire application without guessing.*

---

## 🌟 PART 1: The Big Picture (For Everyone)

Welcome to **Easy Sales Export**! 

Think of this app as a **big, friendly digital marketplace and farm club**. 
* **The Marketplace** is a giant store where farmers can show and sell their amazing crops (like yams, sesame seeds, and hibiscus flowers) to people all over the world.
* **The Cooperatives** is like a piggy-bank savings club where farmers can save money together, win rewards, and borrow money to buy tools.
* **The Academy** is a school where anyone can take video classes to learn how to become a master exporter.
* **The Admin Portal** is the control room where the supervisors (the Admins) make sure everyone plays by the rules and keeps the app running safely.

---

### 📖 The Easy Sales Export Glossary (Simple Words for Big Concepts)

Before we start using the app, let's learn some of the special words we use:

1. **The Wallet:** This is your digital piggy bank inside the app. You put real money into it so you can buy items or save.
2. **Escrow (The Safe Referee):** This is a safety lockbox. When a buyer pays, the money doesn't go straight to the seller. The app holds it safely. When the crops arrive in good condition, the app hands the money to the seller. This protects both sides!
3. **KYC (Identity Check):** This stands for "Know Your Customer". It's like showing your passport to a security guard to prove you are a real, honest person.
4. **QoreID:** This is the security guard software that checks your NIN or BVN to make sure you are who you say you are.
5. **NIN and BVN:** Your National Identification Number and Bank Verification Number. They are like your official government badges.
6. **CAC Certificate:** Corporate Affairs Commission document. It is a certificate that proves your business is real and registered with the government.
7. **Moisture Content:** How wet or dry your crops are. If crops are too wet when shipped on a boat, they will grow mold and rot.
8. **MOQ (Minimum Order Quantity):** The smallest amount of crops a seller is willing to sell. For example, "MOQ: 10 Bags" means you cannot buy just 1 bag; you must buy at least 10.
9. **FOB (Free on Board):** A shipping rule where the seller puts the crops on the ship, and after that, the buyer is responsible for them.
10. **CIF (Cost, Insurance, and Freight):** A shipping rule where the seller pays to transport and insure the crops all the way to the buyer's country.
11. **Bill of Lading:** A shipping receipt from the boat captain that lists all the crops loaded onto the vessel.
12. **Phytosanitary Certificate:** A health report card for your crops, proving they do not have plant bugs or diseases.
13. **Kill-Switch (Feature Toggle):** A giant red switch for Admins. If a part of the app is broken (like bank payments), the Admin can flip this switch to turn off that feature instantly.

---

## 🚜 PART 2: The User Handbook (For Buyers, Sellers & Farmers)

This section shows you how to use the app to buy, sell, save, learn, and export!

---

### 🔑 Step 1: Getting Inside and Your Profile ID Number

#### 1. How to Sign Up (Join the Club)
1. Open your web browser and go to the Easy Sales Export page.
2. Click the green button that says **"Register"** or **"Sign Up"**.
3. Fill out the form fields:
   * **Full Name:** Type your real name.
     > ⚠️ **Error Check:** The system uses smart filters. If you type numbers, random keyboard smashes (like "asdfgh"), or fake names, you will see a red error message: *"Please enter a valid real name."*
   * **Email Address:** Type your active email address. 
     > ⚠️ **Error Check:** If you try to use an email that is already registered, you will see: *"Email address is already in use."*
   * **Phone Number:** Type your Nigerian phone number starting with `0` or `+234`.
     > ⚠️ **Error Check:** If the format is wrong, you will see: *"Please enter a valid phone number."*
   * **Password:** Choose a password that is hard to guess.
4. Click the checkbox that says **"I agree to the Terms of Service"**.
5. Click **"Submit"**.

#### 2. Your Profile ID Number (The ESE Number)
Once you log in, look at your profile dashboard. You will see a unique registration number that looks like this: **`ESE-2026-12345`**. 
* This is your **account identifier**. Whenever you apply for programs, track shipments, or contact support, the system uses this ID number to find your record. (Note: This is different from the physical Cooperative Membership Card, which is only unlocked after joining the Cooperative).

---

### 🛡️ Step 2: Proving Who You Are (KYC Verification)

To make sure everyone on the app is safe, you must pass the KYC check.

#### Step-by-Step Verification:
1. Go to your **Profile Dashboard** (click your name at the top right).
2. Click the button labeled **"Verify Identity"**.
3. You will see the **QoreID Identity Verification Box**.
4. Choose your ID type: **NIN** or **BVN**.
5. Type your ID number in the field.
   > ℹ️ **Why BVN?** This checks your registered bank name against the name you typed. It **cannot** touch your money.
6. Upload a clean, clear photo of your ID card. 
   * Click **"Upload File"**, select the photo from your device, and wait for the upload bar to turn green.
7. Click **"Submit for Review"**.
8. Look at the status badge next to your name. It will change to a yellow box saying **"Pending Review"**.
9. Once the Admin checks and confirms your documents, it will turn into a green box saying **"Active"** or **"Verified"**.

#### 🔧 Troubleshooting Verification Problems:
* **"Name Mismatch" Error:** Make sure the name on your signup form matches the name on your NIN or bank account exactly. If your NIN says "Chinedu Okechukwu" but you signed up as "Chinny O.", the check will fail.
* **"Image Blurry" Error:** If your ID photo is dark or fuzzy, the Admin will reject it. Take a new photo in a bright room and upload again.

---

### 💰 Step 3: The Digital Wallet (Your Piggy Bank)

The app has a built-in money box called the **Wallet** where you keep your funds.

#### 1. Checking Your Balance
1. Click the **Wallet** link on your home screen (it looks like a little credit card icon 💳).
2. The large numbers display your **Wallet Balance** in Naira (₦).

#### 2. Funding Your Wallet (Adding Cash)
1. Click the green button labeled **"Deposit Funds"**.
2. Type the amount of money you want to add (e.g., `50000`).
3. Click **"Proceed to Payment"**. A safe checkout window from **Paystack** will pop up.
4. Choose your payment method:
   * **Pay with Card:** Type your card number, expiry date, and CVV code. Type your PIN when prompted.
   * **Pay with Bank Transfer:** Paystack will display a temporary bank account number. Copy it, open your bank app, and transfer the exact amount to that account. Go back to the checkout window and click *"I have sent the money"*.
   * **Pay with USSD:** Select your bank and dial the displayed code on your phone.
5. Once Paystack confirms the payment, the window will automatically close.
6. Your wallet page will refresh, and your new balance will appear!

#### 🔧 What if my money was debited but my balance didn't change?
* Don't panic! Click the small icon labeled **"Verify Transaction Status"** next to your balance. The app will check the Paystack server and manually update your wallet balance instantly.

---

### 🛍️ Step 4: The Digital Marketplace (The Giant Shop)

This is the marketplace where people buy and sell agricultural commodities: **Yam Tubers**, **Sesame Seeds**, and **Dried Hibiscus**.

```
[ Marketplace Activity Flow ]
 ├── BUYER: Search/Filter → Select Quantity (Tier Price) → Pay via Escrow → Confirm Delivery / Raise Dispute
 └── SELLER: Complete 5 KYC Stages → Create Product Listing → Manage Order States (8 stages) → Withdraw Funds
```

---

#### 🛒 A. How to Buy Things (For Buyers)

##### 1. Browsing and Filtering
1. Go to the **Marketplace** page.
2. Type what you are looking for in the **Search Bar** (e.g., "Sesame").
3. Use the **Dropdown Filters**:
   * **State of Origin:** Filter to show crops from a specific state (e.g., "Kano").
   * **Vendor Rating:** Show only sellers with 4 stars or more.

##### 2. Dynamic Pricing Tiers (Buying More Saves Money!)
When you click on a product, you will see a box showing the **Tiered Pricing Table**:
* **Retail Tier (Small Quantity):** If you buy between 1 and 9 bags, you pay ₦20,000 per bag.
* **Bulk Tier (Medium Quantity):** If you buy between 10 and 99 bags, the price drops to ₦18,000 per bag!
* **Export Tier (Large Quantity):** If you buy 100 bags or more, the price drops to ₦15,000 per bag!
* **How to use it:** Type your desired amount in the **Quantity Box**. Watch the price per unit change dynamically before you add it to your basket!

##### 3. Adding to Cart & Checking Out
1. Click the yellow button that says **"Add to Basket"**.
2. Click the shopping cart icon at the top right of your screen.
3. Review your items, then click **"Proceed to Checkout"**.
4. Fill out the shipping address fields:
   * **Delivery Address:** Type the street name, building number, and city.
   * **Contact Phone:** The number the delivery driver should call.
5. Select **"Pay with Wallet Balance"** or **"Pay via Card Checkout"**.
6. Click **"Confirm & Pay"**.

##### 4. Escrow Protection (How Your Money is Protected)
* Once you pay, your money is sent to a secure **Escrow Ledger**. 
* The seller is notified that the money is secured.
* The seller ships the crops.
* When the truck arrives at your warehouse, inspect the crops.
* If everything is perfect, log in, go to your **Orders** page, and click the green button labeled **"Confirm Delivery & Release Funds"**. The money is now sent to the seller's wallet.

##### 5. Raising a Dispute (If Something is Wrong)
* If your crops arrive spoiled, damaged, or if they do not arrive at all:
1. Go to your **Orders** page.
2. Select the specific order.
3. Click the red button labeled **"Raise Dispute"**.
4. Type a detailed explanation of the issue (e.g., *"The sesame seeds arrived wet and moldy"*).
5. Upload photos of the damaged items.
6. Click **"Submit Dispute"**.
7. This locks the escrow funds completely. An Admin will contact you and the seller to resolve the issue.

---

#### 🧑‍🌾 B. How to Sell Things (For Sellers)

To list items in the shop, you must first register as a vendor.

##### 1. The 5-Stage Seller KYC Onboarding
1. Go to the **Seller Dashboard**.
2. **Stage 1 (Profile check):** Complete your contact details.
3. **Stage 2 (Business registration):** Type your CAC business registration number and upload a scan of your Corporate Affairs Commission certificate.
4. **Stage 3 (Identity verification):** Link your BVN or NIN via the QoreID interface.
5. **Stage 4 (Admin manual review):** An Admin checks your documents. This takes 24-48 hours.
6. **Stage 5 (Storefront setup):** Enter your store name, description, and profile picture. Click **"Launch Store"**!

##### 2. How to List a Product
1. Go to your **Seller Dashboard** and click the green button labeled **"Create Listing"**.
2. **Product Photos:** Drag and drop high-quality photos of your crops.
3. Fill out the details form:
   * **Commodity:** Select Yam, Sesame, or Hibiscus.
   * **Product Title:** (e.g., "Premium Cleaned Sesame Seeds").
   * **Description:** Add details about quality, packaging, and sorting.
   * **Moisture Content (%):** Type the moisture level (e.g., `6%`). 
     > ⚠️ **Quality Check:** Export-grade sesame seeds must have a moisture level under 8%.
   * **Minimum Order Quantity (MOQ):** Type the minimum bags a buyer must purchase.
   * **Origin State:** Select the state where the crops were harvested (e.g., "Benue").
   * **Packaging Type:** Choose Jute Bags, Bags, or Wooden Crates.
4. Set up the **Price Tiers**:
   * Type the price for Retail, Bulk, and Export volumes.
5. Click **"Publish Listing"**.

##### 3. Managing Your Orders (The 8-Stage Lifecycle)
When a buyer places an order, you will see it in your dashboard under **"Active Orders"**. You must update the status as you fulfill the order:
1. `pending_payment`: The buyer is checking out. Do not package yet.
2. `payment_secured`: The buyer paid into Escrow. You can now package the crops!
3. `processing`: You are sorting, cleaning, and packing the crops into jute bags.
4. `in_transit`: The courier has picked up the crops. Type the tracking number or driver's phone number, then click **"Ship Order"**.
5. `delivered`: The crops have arrived at the buyer's address.
6. `completed`: The buyer clicked "Confirm Delivery", and the funds have cleared into your wallet!
7. `disputed`: The buyer raised a complaint. The escrow funds are locked. Wait for the Admin mediator to call.
8. `cancelled`: The transaction was stopped.

---

### 🤝 Step 5: Cooperatives (Savings & Loans Club)

The Cooperative is a savings and credit club.

#### 1. How to Join
1. Go to the **Cooperatives** page.
2. Review the Cooperative guidelines and regulations.
3. You will see the **One-Time Membership Registration Fee** set to **₦10,000**.
4. Click the purple button labeled **"Pay Registration Fee"**.
5. Pay the ₦10,000 via Paystack.
6. Once payment is confirmed, your status changes to **"Member"**, and you unlock access to the Cooperative Dashboard!

#### 2. Savings Contributions (Adding to Your Savings)
To request loans or build credit, you must add money to your savings.
* Contributions must be **₦5,000 and above** per deposit.
1. On your Cooperative dashboard, click **"Add Contribution"**.
2. Type the amount you want to save (e.g., `25000`).
3. Click **"Contribute Now"**. This transfers the money from your Digital Wallet into your Cooperative Savings ledger.

#### 3. Creating Savings Goals (Target Folders)
You can set up separate savings folders for different business needs:
1. Click **"Create Savings Goal"**.
2. Name your goal (e.g., "New Irrigation Pump").
3. Set your target amount (e.g., `₦200,000`).
4. Select a duration lock: **1, 3, 6, or 12 months**.
5. Click **"Launch Goal"**.
6. **Locked Savings Warning:** The goal money is locked until the selected time expires. If you withdraw the money early, a **penalty fee** will be deducted from your savings. If you wait until the end date, you will receive a **10% interest reward** on your savings!

#### 4. Borrowing Money (Taking Loans)
1. Go to the **Loans** panel and click **"Apply for Loan"**.
2. **Understand Your Borrowing Limit:** The app calculates your maximum loan automatically:
   $$\text{Maximum Loan Amount} = \text{Your Total Savings} \times 3$$
   *Example:* If you have saved ₦50,000, you can borrow up to ₦150,000. If you try to request ₦160,000, the system will block the form and say: *"Requested amount exceeds your maximum limit."*
3. Fill out the application form:
   * **Amount Requested:** Type the loan amount.
   * **Repayment Duration:** Select the number of months (up to 12).
   * **Purpose of Loan:** (e.g., "Purchasing fertilizer").
4. Click **"Submit Application"**.
5. Once approved by the Admin, the money will appear in your Digital Wallet instantly. You will see a monthly repayment calendar with the principal and 2% monthly interest breakdown.

#### 5. Paying with Cooperative Credit
* When buying items (like seeds or tools) in the Marketplace, you can select **"Cooperative Credit"** as your payment method at checkout.
* This allows you to checkout instantly using your cooperative balance!

#### 6. The Cooperative Membership ID Card (Cooperative Members Only)
* **What is it?** This is your official Cooperative Member badge. It is **only** for users who have completed the Cooperative registration and paid their ₦10,000 membership fee.
* **How to get it:**
  1. Go to your **Cooperative Dashboard**.
  2. Click on the **"ID Card"** menu tab.
  3. The system will automatically generate a digital membership ID card showing your name, photo, member status, and unique `ESE-YYYY-XXXXX` ID number.
  4. Click **"Download ID Card"** to save or print it for physical use!

---

### 🎓 Step 6: Easy Sales Export Academy (The LMS)

The Academy is a school that teaches you how to export commodities.

1. **Enrolling in a Program:**
   * Go to **Academy**. Select a learning program (Foundation, Standard, or Elite) and enroll.
2. **Watching Lesson Videos:**
   * Click **"Resume Learning"** to open the course player.
   * You will see the video player on the left and the textbook notes on the right.
   * ⚠️ **Anti-Cheat Lock:** You cannot click to watch Lesson 2 until you have watched Lesson 1 to the end. The "Next Lesson" button will remain grayed out until the video finishes.
3. **Taking Course Quizzes:**
   * At the end of each module, you must complete a quiz. Click **"Start Assessment"**.
   * **The Assessment Timer:** A countdown clock will appear at the top. If the timer reaches `00:00`, your quiz is automatically submitted.
   * **Proximity Guard:** Do not leave the quiz tab or open other browser pages. Doing so may trigger the anti-cheat system and auto-submit your quiz with a failing grade.
4. **Getting Your Export Certificate:**
   * If you pass the final exam with a score of **95% or higher**, click the button labeled **"Download Certificate"**.
   * The page will generate a high-quality PDF containing your certificate.
   * **Public Verification Page:** Every certificate features a custom verification code and a QR code. A customs officer or bank manager can scan this QR code to view your verified student page at `/academy/verify/[certificateId]`.
   * **Sharing to LinkedIn:** Click **"Add to LinkedIn Profile"** to link your certification to your LinkedIn page!

---

### 🗺️ Step 7: Farm Nation (Real Estate & Agrarian Land)

Farm Nation helps cooperative members buy or lease verified farm land.

1. Go to the **Farm Nation** page.
2. **Filter Plots:** 
   * Filter by State (e.g., "Oyo State"), Size (e.g., "5 Acres"), and **Crop Viability** (e.g., land best suited for "Loamy Soil - Root Crops").
3. **Reserving Land:**
   * Click on a land listing. The seller's phone number is hidden for security.
   * Click **"Initiate Purchase"**.
   * Read the **Zoning and Land Use Agreement** checkbox. Check the box to agree (this states you will only use the land for agriculture).
   * Click **"Lock Land Reservation"**. The down payment is secured in Escrow.
   * An Admin inspector will visit the plot to check boundaries. Once verified, the deal is completed and the title deed is signed over to you.

---

### 🌊 Step 8: WAVE Program (Women's Agro-processors Venture Empowerment)

WAVE is an empowerment program for female agro-processors.

1. **Access Gate:** Only users registered with a profile gender of **Female** can enter this portal. Male accounts will see a lock screen saying *"Access Restricted to WAVE Participants."*
2. **Announcements Board:** View upcoming grant details, processing workshop locations, and regional events.
3. **Resource Library:** Click **"Resource Library"** to download guides for starting a processing plant, SME loan applications, and export checklists.

---

### 🚢 Step 9: Export Logistics Engine

When you are ready to ship your commodities out of Nigeria, book an export slot!

1. Go to the **Export Dashboard** and click **"Book Export Slot"**.
2. **Follow the 5-Stage Booking Wizard:**
   * **Stage 1 (Commodity):** Select Yam, Sesame, or Hibiscus and enter your total weight in metric tons.
   * **Stage 2 (Specs):** Enter your crop specifications: moisture percentage, foreign matter percentage, and confirm that you have a Phytosanitary Certificate.
   * **Stage 3 (Logistics):** Select your shipping terms (FOB or CIF), choose your Port of Origin (e.g., "Lagos Apapa Port"), and select your Cargo Vessel.
   * **Stage 4 (Documents):** Upload photos of your *Bill of Lading* and *Certificate of Origin*.
   * **Stage 5 (Tax Settlement):** The engine will calculate your port duties and export taxes. Click **"Pay and Confirm Slot"**.
3. **The Export Calendar:** Your dashboard will now render a calendar showing your cargo drop-off date, ship loading days, and vessel departure date.

---

## 🎛️ PART 3: The Administrator Playbook (For Admins & Super Admins)

Welcome to the command room! As an Admin, you manage the platform at `/admin`. This is a strict **Zero-Trust** environment where every action is logged.

```
[ Admin Dashboard Overview ]
 ├── Sidebar Navigation (Analytics, Finance, Communications, User Directory, Withdrawals, Toggles)
 ├── Analytics Telemetry: Real-Time Server-Side count() Aggregations (Recharts API)
 ├── Finance Desk: Withdrawal approvals & loan underwriting evaluations
 └── Comm Center: Priority announcements, live previews, and cohort segmentation
```

---

### 🧭 1. Navigation & Access Control
Once you log in as an Admin, a dark sidebar will appear on the left side of your screen:
* 📊 **Analytics:** Main dashboard displaying system charts.
* 👥 **User Directory:** List of all registered members.
* 💳 **Finance:** Payouts and loan ledger controls.
* 📣 **Communications:** Banner announcements and targeted broadcasts.
* ⚙️ **Feature Toggles:** Feature switches to disable parts of the app during emergencies.

---

### 📊 2. The Analytics & Telemetry Room (`/admin/analytics`)

Use this page to check the platform's performance.

* **Core KPI Metric Cards:** Display active users, total savings, active loan volumes, and pending approvals.
  * 🔄 **Live Server Counting:** These numbers use Firestore `count()` aggregations to scan the database. While loading, you will see a spinner. Once loaded, they show the exact totals across the entire platform.
* **Telemetry Charts:**
  * **Revenue Trend (Line Chart):** Maps platform commission earnings over the last 6 months.
  * **User Registrations (Bar Chart):** Shows the sign-up velocity of new users per month.
  * **Module Breakdown (Pie Chart):** Displays which module has the highest traffic.

---

### 💵 3. Financial Oversight & Underwriting (`/admin/finance`)

Admins act as security guards for all financial transactions.

#### 1. Approving Wallet Withdrawals
1. Go to the **Withdrawals** page.
2. Review the pending payout requests.
3. Click on a request to check details:
   * Confirm the user's KYC status is **Verified** (Green badge).
   * Confirm the bank account name matches the user's KYC name.
4. If correct, click **"Approve Payout"**. The system will process the Paystack transfer.
5. If there is a name mismatch, click the red **"Reject Payout"** button, select the reason from the dropdown, and click confirm.

#### 2. Underwriting Cooperative Loans
1. Go to the **Cooperative Loans** page.
2. Select a pending loan application.
3. Review the loan underwriting report card:
   * **Total Saved:** The user's active savings contribution.
   * **Requested Amount:** The loan amount they want to borrow.
   * **Debt Ratio:** Checks if they have outstanding unpaid loans.
   * **Multiplier Check:** Confirms the request does not exceed 3x their savings.
4. Click **"Approve Loan Application"** to deposit the funds into their wallet, or click **"Deny Loan"** to reject the request.

---

### 📢 4. The Communications Center (`/admin/communications`)

Use this suite to broadcast news and alerts to users.

#### 1. Segment Targeting (Choosing Your Audience)
Before sending a message, choose your audience in the dropdown list:
* **All Users:** Sends the message to every account.
* **Active Last 30 Days:** Targets only frequent users.
* **Fully Verified Sellers:** Targets only merchants.
* **WAVE Only:** Targets only female participants.
* **CSV Cohort Upload:** Drag and drop a CSV file containing user emails to target a specific custom list.

#### 2. Creating Global Dashboard Banners
1. Type your announcement in the text field.
2. As you type, look at the **Live Preview Box** on the right. This shows exactly what the banner will look like on the user's screen!
3. Select a **Priority Level** (Color Theme):
   * 🟦 **Information (Blue):** For general news.
   * 🟩 **Success (Green):** For positive announcements.
   * 🟨 **Warning (Yellow):** For scheduled maintenance alerts.
   * 🟥 **Critical (Red):** For urgent alerts.
4. Click **"Publish Announcement"**. It will instantly appear at the top of all user dashboards!

---

### 👥 5. The User Directory (`/admin/users`)

This page displays the list of all registered members.

#### 1. Cursor-Based Infinite Scroll
* Scroll down the page; more users will load automatically.
* The directory uses cursor-based pagination. This means that even if new users register while you are scrolling, you will not see duplicate records or skip anyone.

#### 2. High-Velocity Bulk Actions
1. Select multiple users by checking the boxes on the left.
2. A floating **Bulk Actions Bar** will slide up from the bottom of your screen!
3. Click **"Approve KYC"** on the floating bar. The system will process all selected accounts at once, saving you time!

#### 3. Exporting Datasets
* To download your current list of users, click the **"Export CSV"** button. 
* The system will download a `.csv` spreadsheet file to your computer containing the names, emails, phone numbers, and roles of the selected users.

---

### 🛑 6. The Rejection Modal (The Red Card)

Whenever you reject an application (like a loan, a seller profile, or land booking), you must use the **Rejection Modal**.

1. Click the **"Reject"** button on an application.
2. A modal window will pop up.
3. **Write a Justification:** You must type a reason explaining why the application is rejected (e.g., *"CAC Certificate copy is blurry and unreadable"*). 
   > ⚠️ **Length Rule:** Your text must be between 10 and 500 characters. You cannot leave this blank or type short words like "no".
4. Click **"Confirm Rejection"**. The submit button will display a loading spinner and lock itself to prevent double clicks. The user will receive an email and dashboard notification containing your reason.

---

### 📝 7. Transparency Audit Logs & Switches

#### 1. Non-Editable Audit Logs
* Go to the **Audit Logs** page to view a history of every administrative change.
* When an admin edits user details (like correcting a phone number), the system saves a snapshot showing:
  * The name of the Admin who made the change.
  * The old data value (**"Before"**).
  * The new data value (**"After"**).
  * These logs are read-only and cannot be edited or deleted by anyone (including admins) to guarantee accountability.

#### 2. The Global Feature Toggles Matrix (Kill-Switches)
* Go to the **Feature Toggles** page.
* You will see a list of toggles for different app features:
  * `Loan Applications` (On/Off)
  * `Withdrawal Requests` (On/Off)
  * `Export Window Registrations` (On/Off)
* If there is an emergency (such as a bank checkout issue or a liquidity crunch), a Super Admin can toggle a switch to **"Off"**. 
* This immediately hides that feature from the user-facing app globally, preventing any new submissions without needing code changes!
