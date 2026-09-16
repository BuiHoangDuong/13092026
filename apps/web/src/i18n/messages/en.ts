export const en = {
  nav: { exchanges: "Exchanges", guides: "Guides", wallet: "Wallet" },
  home: {
    eyebrow: "Crypto affiliate cashback",
    title: "Keep more of every trading fee.",
    lead: "Compare verified exchange offers, link your UID, and follow each cashback movement from commission to withdrawal.",
    flexible: "Flexible",
    viewOffer: "View offer",
    empty: "Start PostgreSQL and run the seed command to load exchange offers.",
    statsTitle: "Why choose us?",
    statsUsers: "Users",
    statsCountries: "Countries",
    statsExchanges: "Exchanges",
    ledgerTitle: "Online Rebate Ledger",
    ledgerLead: "Once live, this table updates daily from published affiliate reports. You'll be able to check your own balance in your wallet.",
    ledgerDemoBadge: "Illustrative example — not live data",
    ledgerColExchange: "Exchange",
    ledgerColRate: "Rate",
    ledgerColUid: "UID",
    ledgerColRebate: "Rebate",
    ledgerColDate: "Date"
  },
  exchanges: {
    eyebrow: "Published partners",
    title: "Compare exchanges.",
    upTo: "Up to",
    exampleLabel: "Example",
    exampleTemplate: "$100 affiliate commission \u2192 ${{amount}} back",
    cashbackLabel: "Spot & futures cashback",
    conditionsFallback: "On eligible affiliate commission after the holding period.",
    getLink: "Get referral link",
    empty: "No published offers yet."
  },
  exchange: { eyebrow: "Exchange offer" },
  lookup: {
    title: "Check your cashback", lead: "Choose your exchange and enter your UID to see your cashback. No account required.",
    exchange: "Exchange", choose: "Choose an exchange", uid: "Account UID", uidPlaceholder: "Your exchange account UID",
    check: "Check cashback", withdraw: "Verify email and withdraw", loading: "Checking…", help: "Use your account UID, not a referral code. Keep any leading zeros. Balances are separate for each currency.",
    available: "Available to withdraw", pending: "Pending", noData: "No cashback data for this UID under our referral links yet.",
    lastImport: "Last report published (UTC)", sourceAsOf: "Source data as of (UTC)", unknown: "Not provided",
    rateLimited: "Too many lookups. Try again in {{seconds}} seconds.", unavailable: "Cashback is temporarily unavailable. Please try again."
  },
  withdrawal: {
    title: "Withdraw cashback", firstReview: "Your first withdrawal for each UID always goes to admin review.",
    verifyEmail: "Verify your email", exchange: "Exchange", choose: "Choose an exchange", uid: "Account UID", email: "Email",
    bindingNote: "The first verified email is bound to this UID. Future access requires that email. Verification grants access for 30 minutes.",
    sendCode: "Send verification code", code: "6-digit verification code", verify: "Verify and continue", resend: "Request another code", expires: "Code expires (UTC)", signOut: "End UID session",
    request: "Request withdrawal", asset: "Currency", amount: "Amount", network: "Network", address: "Payout address",
    availableOnly: "Only available cashback can be withdrawn. Check the network and address carefully. A recovery adjustment blocks new requests.",
    history: "Withdrawal history", cancel: "Cancel withdrawal", more: "Load older activity", queue: "Withdrawal queue", first: "First withdrawal",
    manualPayout: "Payouts are manual. Mark paid only after sending funds and record the transaction reference.",
    note: "Decision note", payoutRef: "Payout transaction reference", confirm: "Confirm {{action}} for this withdrawal?", empty: "No open withdrawals.", newest: "Newest page", next: "Next page",
    unavailable: "Withdrawals are temporarily unavailable. Please try again later.",
    actions: { APPROVE: "Approve", REJECT: "Reject", MARK_PAID: "Mark paid" },
    statuses: { REQUESTED: "Requested", UNDER_REVIEW: "Under review", AUTO_APPROVED: "Auto-approved", APPROVED: "Approved", PAID: "Paid", REJECTED: "Rejected", CANCELLED: "Cancelled" }
  },
  cashback: {
    title: "Your cashback", lead: "Track your Bybit cashback in one place.",
    available: "Available", pending: "Pending", reserved: "Withdrawal processing", withdrawn: "Paid out", receivable: "Adjustment to recover",
    noData: "Waiting for a published Bybit report. This is not a zero balance.",
    uidLabel: "Bybit UID",
    uidHelp: "Use your Bybit account UID, not a referral code. Keep any leading zeros.",
    unavailable: "Cashback is temporarily unavailable. Please try again.",
    lastImport: "Last report published", sourceAsOf: "Source data as of", unknown: "Not provided",
    wallet: "View wallet and history", refresh: "Refresh", loading: "Updating…", history: "Cashback history", more: "Load older activity",
    emptyHistory: "No cashback movements yet.", date: "Date", movement: "Movement", amount: "Amount",
    holdNote: "Pending cashback becomes available after the configured holding period. Amounts are shown separately for each currency.",
    labels: { CREDIT: "Cashback credited", HOLD_RELEASE: "Became available", REVERSAL: "Report correction", CLAWBACK: "Recovery adjustment", ADJUSTMENT: "Reconciled", WITHDRAWAL_RESERVE: "Withdrawal reserved", WITHDRAWAL_RELEASE: "Withdrawal released", WITHDRAWAL_SETTLE: "Withdrawal paid" }
  },
  guides: { eyebrow: "Knowledge base", title: "Cashback guides.", general: "General", empty: "No published guides yet." },
  guide: { eyebrow: "Guide", comingSoon: "Content coming soon." },
  siteFooter: {
    brand: "Cashback Hub",
    tagline: "Crypto exchange cashback, made transparent.",
    columns: [
      { title: "Resources", items: ["Getting started", "How cashback works", "Supported exchanges", "FAQ"] },
      { title: "Company", items: ["About us", "Blog", "Careers", "Contact"] },
      { title: "Legal", items: ["Terms of service", "Privacy policy", "Cookie policy", "Risk disclosure"] },
      { title: "Community", items: ["Telegram", "Discord", "Twitter / X", "Newsletter"] }
    ],
    disclaimer: "Cashback balances are based on published affiliate reports.",
    placeholderNote: "Pages coming soon — every link below returns to the homepage for now."
  }
} as const;
