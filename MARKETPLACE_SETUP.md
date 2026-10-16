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

## Notun: Coupon + Admin Wallet (update)
**Kono SQL chalate hobe na.** Server start holei notun table (`coupons`, `coupon_redemptions`, `admin_wallet_tx`) auto toiri hoy.

### Coupon
| Ke banabe | Kothay | Discount ke dibe |
|---|---|---|
| Seller | Seller dashboard > **Coupons** | **Seller** nijer sale amount theke. Commission ager moto **original price**-er upor kata hoy. |
| Admin | Admin panel > **Coupons** | **Zento** (admin nijer pocket theke). Seller tar full earning pabe (original price - commission). |

- Seller coupon shudhu oi seller-er product-e kaj kore. Admin coupon puro cart-e kaj kore.
- Percent / fixed, max discount, minimum order, total limit, per-customer limit, start/expiry date, pause/resume ache.
- Customer checkout-e "Coupon code" box-e code diye Apply kore. Server abar check kore, tai browser theke discount badano jay na.
- Delivery fee ager moto (100 taka-r upor free) coupon-er age-r subtotal diye hisab hoy.
- Seller coupon-er discount seller-er (100 - commission%)-er beshi hote pare na, jate seller-er earning minus na hoy.
- Example (sale 150, commission 10%, coupon 30): Seller coupon -> seller pay 105, Zento commission 15. Admin coupon -> seller pay 135, Zento commission 15 - 30 = -15.

### Admin Wallet (Admin panel > **Admin Wallet**)
- **Commission wallet**: order delivered hole commission jama hoy. Admin coupon-er discount ekhan theke minus hoy.
- **Sellers' money**: sob seller-er earning ekshathe jama hoy. Admin **Withdrawals**-e Approve (paid) korle oi amount ekhan theke minus hoy. Reject korle kichu minus hoy na.
- Ager (update-er age-r) delivered order ar paid withdrawal gulo prothom boot-e auto wallet-e tule neya hoy.
- Bhul thakle ba nijer commission tule nile **Save entry** diye manual add/minus kora jay.
