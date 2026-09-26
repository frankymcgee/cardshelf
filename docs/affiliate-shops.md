# Affiliate shops

CardShelf v0.38 adds optional external shopping links to the marketplace, collection card details and public catalogue card details. Links work for visitors and every membership tier. The external retailer takes payment and handles delivery; CardShelf does not import inventory, reserve products or create orders.

## Set up a shop

1. Apply migration `024_affiliate_shops.sql` through the normal deployment migration step. Affiliate shopping starts disabled with no shops.
2. Obtain approval from each affiliate programme, including its complete tracking URL and any rules for search links, eligible products and territories. An ordinary shop URL does not create an affiliate relationship.
3. Open **Admin → Affiliate shops** and select **Add shop**. Enter the shop name, description and complete HTTPS affiliate URL. Tracking query parameters are preserved.
4. Optionally add an approved search URL containing `{query}` in its path or query string. CardShelf substitutes URL-encoded public card name, set, number and language, or the marketplace search. It never includes account details or collection notes. Leave this blank if the programme does not support search links; links then open the shop URL.
5. Optionally enter a referral/coupon code for customers to copy into the shop's checkout. CardShelf displays it without promising a discount or applying it automatically. Add an end date if needed; the entire shop is hidden after that UTC date.
6. Choose placements and games, reorder shops, and inspect the live draft preview. The preview includes paused shops with valid, unexpired links. Clicking a preview opens the external shop.
7. Enable the shop and **Show affiliate shopping links**, confirm your current administrator password and save. Up to 12 shops are supported. Changes are audited and concurrent edits are rejected so one administrator cannot silently overwrite another.

Use a pack category or sealed-product landing page as a shop URL to offer packs. Card searches do not confirm an exact printing, product language, price or availability. General marketplace browsing shows every enabled shop; card pages respect the selected games. Private sale management does not display these links.

URLs and referral codes are public. Do not paste API keys, secrets or private customer information. Only public HTTPS destinations are accepted, without embedded credentials. Outbound links open in a new tab and use `sponsored nofollow noopener`. Their `strict-origin-when-cross-origin` referrer policy identifies the CardShelf website origin to an external retailer without sending private page paths or queries. Every displayed group includes the commission disclosure. No third-party scripts, automatic visits or click analytics are added. The provider records attribution and pays rewards under its own agreement.

The public endpoint returns only currently enabled, unexpired shops when the global switch is enabled. Unsaved previews never change it. If settings cannot be loaded, optional shopping links remain hidden and the rest of the page still works. Disabling settings takes effect on subsequent page loads; an already open page is not a live subscription to configuration changes.

## Start with Amazon: binders, sleeves and packs

Use **Add Amazon starter links** to create these three editable, paused entries. Paste a complete link for each entry from Amazon's SiteStripe or Mobile GetLink, using the country programme you joined. Remove any unused entries before saving. Specific product links or relevant product-list links can be used. A product-list link needs relevant original content alongside it; adapt each description to what you selected.

Amazon links are preserved exactly, including Amazon short links. Search templates and referral/coupon codes are not used for Amazon: the tracking ID belongs in the supplied link. CardShelf labels the destination as Amazon and adds its required Associate disclosure. It does not fetch Amazon product images, prices, stock, reviews or ratings. No Amazon API key is required for these text links.

List CardShelf's public website URL in Associates Central. **CardShelf records card price history; Amazon's participation rules restrict sites with price-tracking or alerting unless Amazon agrees. Confirm this existing functionality with Amazon before enabling links.** Native/mobile-app distribution has separate approval requirements. Signup and displaying links do not guarantee qualifying sales or approval; eligibility and earnings reports are managed by Amazon.

Official sources reviewed on 26 September 2026: [Australian agreement](https://affiliate-program.amazon.com.au/help/operating/agreement), [participation rules](https://affiliate-program.amazon.com.au/help/operating/policies), [linking tools](https://affiliate-program.amazon.com.au/welcome/topic/tools), and [Mobile GetLink](https://affiliate-program.amazon.com.au/help/node/topic/GH37MDS5PLQ9Z366). Confirm the corresponding terms if enrolled in another country programme.

## CardTrader assessment

Official sources reviewed on 26 September 2026:

- [CardTrader terms](https://static.cardtrader.com/en/pages/terms-of-service)
- [API reference](https://www.cardtrader.com/en/docs/api/full/reference)
- [Buying through the API](https://www.cardtrader.com/en/docs/api/full/how-to-buy)
- [Frequently asked questions](https://static.cardtrader.com/en/pages/faq)

The terms describe partner referral codes issued at CardTrader's discretion. Associated rewards are a percentage set by CardTrader on eligible CardTrader Zero purchases, with an eligible purchase amount capped at EUR 100 or its currency equivalent. Direct-seller purchases and shipping are excluded. Codes are entered in the cart before checkout, have programme-specific validity and restrictions, and rewards remain pending for 30 days. Confirm current eligibility, billing requirements, reward rate and promotion rules with CardTrader before publishing. CardShelf does not assume or construct a CardTrader affiliate URL format.

CardTrader's API exposes catalogues, marketplace listings, cart operations and purchasing with billing/shipping addresses. API credentials do not themselves establish commission eligibility. The terms require written, case-by-case permission for wide third-party access to market data such as listings and prices; synchronising your own inventory is treated separately.

Automated buying would need a separate design and agreement. The API cart is shared within an account, and Zero combines purchases in an account's personal box. Those behaviours are unsuitable for assuming independent customer orders through one CardShelf account. Confirm permission for embedded resale, customer shipping/returns, customer separation and commission attribution before implementing ordering. No CardTrader API credentials, automated purchases, stock imports or wallet payments are part of this release.

Use CardTrader's [support form](https://www.cardtrader.com/en/issues/new?embedded=true) to discuss **Partnerships & collaborations**, **Referral & coupons**, or **API & synchronization**. A configured generic link can be used with an issued referral code once their requirements are agreed.
