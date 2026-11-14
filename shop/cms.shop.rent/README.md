# cms.shop.rent

A product with `rent_interval` (`1 hour`, `1 day`) is rented. A line carries the times in its data,
`{ rent: [{ begin, end }] }`, unix time; the amount is the number of intervals, and the unit price
what they cost on average. Times that are none (not whole seconds, not forwards, more than 10 000
intervals in a line) make the amount 0, and a time begun is gone. `shop_rent_price` holds the rules: from `weekday(monday-friday) hour(8-11)`
at a factor of the product's price, without a factor not to be rented then. A placed order takes its
times (`shop_rental`), a canceled one gives them back, and a line with a time that is gone cannot be
placed; it offers to drop it.

How times are chosen is the site's: a calendar, a form. `pub/selector.js` reads the rules in the browser too.

`rent_capacity` says how many can be rented for the same time (default 1): the same time twice in a
line is two of them, and the lines before it in the same order count too. `free(app, product, range)` tells how many are still free; `cms.cont.shop.rent`
is a block that books a week of times on a product's page.

`calendar.ts` exposes occupied `shop_rental` intervals as a calendar source. Guests receive none;
users see their own reservations, and users allowed to manage orders (or superusers) see all.
Entries link to the order editor when available, otherwise to the product. Calendar reads never
create bookings or change availability.
