/* ZENTO DELIVERY CHARGE
   Inside Dhaka division = ৳70, everywhere else = ৳130.
   The server calculates the real fee again when the order is placed. */
(function () {
  var DHAKA_FEE = 70, OUTSIDE_FEE = 130;

  var DIVISIONS = {
    "Dhaka": ["Dhaka", "Gazipur", "Narayanganj", "Narsingdi", "Munshiganj", "Manikganj", "Tangail", "Kishoreganj", "Faridpur", "Gopalganj", "Madaripur", "Rajbari", "Shariatpur"],
    "Chattogram": ["Chattogram", "Cox's Bazar", "Cumilla", "Feni", "Brahmanbaria", "Noakhali", "Chandpur", "Lakshmipur", "Rangamati", "Khagrachhari", "Bandarban"],
    "Rajshahi": ["Rajshahi", "Bogura", "Pabna", "Sirajganj", "Natore", "Naogaon", "Chapainawabganj", "Joypurhat"],
    "Khulna": ["Khulna", "Jashore", "Satkhira", "Bagerhat", "Narail", "Magura", "Jhenaidah", "Kushtia", "Chuadanga", "Meherpur"],
    "Barishal": ["Barishal", "Bhola", "Patuakhali", "Pirojpur", "Jhalokati", "Barguna"],
    "Sylhet": ["Sylhet", "Moulvibazar", "Habiganj", "Sunamganj"],
    "Rangpur": ["Rangpur", "Dinajpur", "Kurigram", "Gaibandha", "Lalmonirhat", "Nilphamari", "Panchagarh", "Thakurgaon"],
    "Mymensingh": ["Mymensingh", "Jamalpur", "Netrokona", "Sherpur"]
  };

  function norm(v) { return String(v || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }

  var dhakaSet = {};
  DIVISIONS["Dhaka"].forEach(function (d) { dhakaSet[norm(d)] = 1; });

  function isDhaka(city) {
    var k = norm(city);
    if (!k) return false;
    if (dhakaSet[k]) return true;
    return /dhaka$/.test(k);
  }

  function fee(city) { return isDhaka(city) ? DHAKA_FEE : OUTSIDE_FEE; }

  function fill(select) {
    if (!select || select.tagName !== "SELECT" || select.dataset.filled) return;
    var html = '<option value="">Select your district</option>';
    Object.keys(DIVISIONS).forEach(function (div) {
      html += '<optgroup label="' + div + ' Division' + (div === "Dhaka" ? " (৳" + DHAKA_FEE + ")" : " (৳" + OUTSIDE_FEE + ")") + '">';
      DIVISIONS[div].forEach(function (d) { html += '<option value="' + d + '">' + d + "</option>"; });
      html += "</optgroup>";
    });
    select.innerHTML = html;
    select.dataset.filled = "1";
  }

  window.ZentoDelivery = { DHAKA_FEE: DHAKA_FEE, OUTSIDE_FEE: OUTSIDE_FEE, DIVISIONS: DIVISIONS, isDhaka: isDhaka, fee: fee, fill: fill };

  document.addEventListener("DOMContentLoaded", function () {
    fill(document.getElementById("checkoutCity"));
    fill(document.getElementById("profileCity"));
  });
})();
