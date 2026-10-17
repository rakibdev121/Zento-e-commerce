# Zento Marketplace: kibhabe cholbe

## Notun ja ja add hoyeche
| Feature | Kothay |
|---|---|
| Seller application + admin approve/reject/suspend + Verified badge | Admin panel: **Sellers** |
| Seller dashboard (products, orders, wallet, store profile) | `/seller/` |
| Seller-er alada public landing page (Amazon storefront-er moto) | `/store/<store-slug>` |
| Sell-er por 10% commission kete rakha (admin theke % change kora jay) | Admin panel: **Marketplace** |
| Seller wallet + withdraw request, admin approve (paid) / reject | Seller: Wallet, Admin: **Withdrawals** |
| 1-5 star review (product popup-e), verified purchase tag | Storefront product popup |
| Product card-e star + seller name + verified tick | Storefront |

## Deploy korar niyom
1. Ei zip-er file gulo apnar repo-te copy/replace korun (`.env` kothao nei, apnar Render env jemon ache temon thakbe).
2. GitHub-e push korun. Render auto-deploy korbe.
3. **Kono SQL chalate hobe na.** Server start holei notun table (`sellers`, `withdrawals`,
   `seller_transactions`, `reviews`, `marketplace_settings`) auto toiri hoy. Apnar ager table
   (`users`, `products`, `orders`, `order_items`) delete hoy na, shudhu kichu notun column add hoy.
4. Notun environment variable lagbe na.

## Kon file change hoyeche
- NOTUN: `backend/marketplace.py`, `seller/` (index.html, seller.css, seller.js), `store.html`,
  `js/store.js`, `js/marketplace-ui.js`, `css/marketplace.css`
- CHANGE (chhoto): `backend/app.py` (get_products, create_order, order delivered hook, file-er sheshe 20 line),
  `admin/admin.js` (3 ta notun menu), `index.html` (2 line), `_redirects`

## Money kibhabe chole
1. Customer order dey. Order item-e seller_id save hoy.
2. Admin order status **delivered** korle: sell-er 10% (item subtotal-er upor, delivery fee-r upor na) platform rakhe,
   baki seller wallet-e jama hoy. Ekta order dui bar credit hoy na.
3. Seller Wallet theke withdraw request dey (minimum 500 BDT, admin change korte pare). Request dile taka wallet theke hold hoy.
4. Admin **Withdrawals**-e giye bKash/Nagad-e taka pathay, tarpor **Approve** (paid) chape. Reject korle taka wallet-e ferot jay.

## Test korar flow
1. Normal account banan (store-e signup) > `/seller/` e login > "Submit application".
2. Admin panel > **Sellers** > Approve (chaile Verify).
3. Seller dashboard > Store tab-e payout number dan > Products tab-e product add.
4. Onno account diye oi product order korun > admin panel-e order **delivered** korun.
5. Seller Wallet-e 90% dekhabe > withdraw request > Admin **Withdrawals** theke approve.
6. Delivered hoyar por customer product popup-e review dite parbe.

## Jene rakhun
- Product add korle seller-er product sathe sathe live hoy (admin approval lage na, chaile pore add kora jabe).
  Admin chaile seller suspend korle tar sob product store theke lukiye jay.
- Order status (shipped/delivered) ekhon admin-i change kore; seller shudhu order dekhte pare.
- Image upload ager moto Supabase `product-images` bucket-e hoy.
- Review dite hole delivered order lage. Eta Admin > Marketplace theke off kora jay.

## Notun: Seller apply + Admin ID/Password dewa (update)
1. Seller `/seller/` e giye **Apply as seller** chape (customer account lagbe na): nam, store, email, phone, thikana.
2. Admin panel > **Seller Applications** > **Approve**. Password khali rakhle auto toiri hobe.
3. Approve korle ekta box-e **Login ID + Password** dekhabe. **Copy** kore seller ke WhatsApp/SMS-e pathan (password ekbar-i dekhay).
4. Seller `/seller/` e **Seller login** diye dhukbe. Prothom login-e nijer notun password dite hobe.
5. Kono SQL chalate hobe na. Server start holei `seller_applications` table auto toiri hoy.

## Notun: Coupon system (update)
**Seller coupon** (Seller dashboard > Coupons): shudhu oi seller-er product-e kaj kore. Discount **seller-er nijer**.
Commission customer jei dam-e kinse (discount-er por) setar upor kata hoy.
Udahoron: 1000 tk product, 10% seller coupon: customer dey 900, commission 10% = 90, seller pay 810.

**Admin coupon** (Admin panel > Coupons): shob product-e kaj kore. Discount **Zento-r pocket theke**.
Seller port tar full tk-i pay (commission ager moto 1000 tk-er upor). Udahoron: 1000 tk, admin coupon 100 tk: customer dey 900, commission 100, seller pay 900, Zento-r net 100 - 100 = 0.

Coupon-e thake: percent/fixed, max discount, minimum order, kotobar use hobe, prottek customer kotobar, start/end date, on/off.
Delivery fee ager moto original subtotal dhore hoy (discount-er age). Kono SQL lagbe na, server start holei `coupons` table auto toiri hoy.

## Notun: Cost price + profit hisab (update)
- Seller product add/edit-e **Cost price** (je dam-e kine ba banay) dewa **must**. Form-e live dekhay: selling price - Zento commission - cost = profit per unit.
- Cost price shudhu seller dekhe. Customer-er store/API-te kothao jay na.
- Order hole cost ager moto "snapshot" hoye order_items-e jay, tai pore cost bodlale purono order-er profit bodlay na.
- Seller dashboard: Overview-e **Total profit**, Products-e Cost ar Profit/unit, Orders-e prottek order-er Profit (delivered hole real, nahole "estimate").
- Seller coupon dile profit-e discount-o ghata hoy; Zento coupon dile seller-er profit kome na.
- Ager product-gulor cost nai: seller-ke "Add cost" dekhabe, edit kore cost dilei profit calculate hobe.

## Notun: Cancel / Return / Refund, Shipping tracking, Email, Password reset, Activity log
**Cancel & return**
- Customer: Profile > Orders-e *pending/approved* order-e **Cancel order** button.
- Admin: Order > Status > **Cancelled** (delivery-r age) ba **Returned** (delivery-r pore). Karon likhte hoy.
- Cancel/return hole: stock fire ashe, coupon-er use fire ashe, delivered order hole seller-er taka wapas kete ney (wallet-e `sale_refund`).
- bKash/Nagad-e agei taka dile ba return hole **Refund due** dekhay. Taka pathiye admin order-e **Mark refund sent** chape.
- Commission/seller wallet-er hisab theke cancelled/returned order bad jay.

**Shipping**
- Admin order Approve korar por seller **Orders > Mark shipped** diye courier + tracking number dey. Customer order-e tracking dekhe.
- Order-er shob seller-item shipped hole order nijei *Shipped* hoye jay.

**Email (Resend)** — signup OTP-er moto-i `RESEND_API_KEY` use hoy. Kono notun SQL/key lagbe na.
- Seller approve hole ID/password email-e jay. Seller-er notun order-e email. Customer-er shipped/delivered/cancelled/refund email.
- JORURI: `RESEND_FROM_EMAIL` jodi `onboarding@resend.dev` thake, Resend shudhu apnar nijer email-e pathay. Shobar kache pathate Resend-e nijer domain verify kore `RESEND_FROM_EMAIL=orders@yourdomain.com` set korun.
- Optional: `PUBLIC_BASE_URL=https://your-site.com` (password reset link-er jonno; na dile server nije bujhe nibe).

**Seller password reset**: Seller login-e **Forgot your password?** > email-e ek-bar-er link (30 min).
**Activity log**: Admin panel > **Activity log** (seller approve, withdrawal, coupon, order status, refund, settings).

## Notun: Delivery charge, Return = seller-er dayitto, Seller app alada, Admin wallet, Go-live

**Delivery charge (area onujayi)**: Dhaka division-er 13 ta jela (Dhaka, Gazipur, Narayanganj, Narsingdi, Munshiganj, Manikganj,
Tangail, Kishoreganj, Faridpur, Gopalganj, Madaripur, Rajbari, Shariatpur) = **৳70**. Baki shob jela = **৳130**. Free-delivery rule shoriye deya hoyeche.
Checkout-e customer jela select kore (dropdown). Server nijei fee hishab kore, tai browser theke bodlano jay na.

**Return = seller-er dayitto**: delivered order return hole seller-er income wapas kete neya hoy, **ar oi order-er delivery charge-o seller-er wallet theke kata hoy**
(`return_charge`). Seller-er balance minus hote pare; minus thakle withdraw kora jay na, notun sale age ta shodh kore. Admin-er commission/pool-e kono lokshan nei.

**Seller panel / APK**: ager moto same server-e: `/seller/` (web panel) ar `/api/seller/*` + `/api/login` (APK). Store-er website-e kono "Sell on Zento" / seller link nei.

**Admin Wallet**: 3 ta section: *My money* (commission, delivery charge Dhaka/outside bhag kore, own product sales, return charge recovered),
*Customer money* (pool, refund baki), *Sellers* (seller-ke deya baki, seller-er kache pawna).

**Go live**: Admin > Settings > *Clear test data*. Test order, wallet history, withdrawal, review, chat, activity log muche jay; order number abar #1 theke shuru.
Product, customer, seller, coupon, admin account thake. Type korte hoy: `DELETE TEST DATA`. Eta undo hoy na, age Supabase/Render DB backup nin.
