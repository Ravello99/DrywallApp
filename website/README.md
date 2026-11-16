# VanGuard Drywall & Acoustics website

One-page company site: services, project types, how we work, past work, careers, an estimate
request form and **Employee login** buttons that open the app.

## Preview
The app server already serves it at **http://YOUR-SERVER-IP:8000/site/** (after `python3 run.py update`).
There, Employee login opens the app on the same server and estimate requests go straight into
the app's **Bids** tab (estimators and coordinators get a notification).

## Hosting it on your own domain
Upload `index.html` and the `assets/` folder to any web host, then edit the `SITE` settings
near the bottom of `index.html`:

```js
var SITE = {
  appUrl: 'http://YOUR-SERVER-IP:8000',   // where Employee login goes
  apiUrl: 'http://YOUR-SERVER-IP:8000',   // receives estimate requests
  email: 'info@AltraDrywall.ca',          // change when the VanGuard address is ready
  phone: '289-866-7222'
};
```

If `apiUrl` is empty or the server can't be reached, the form opens the visitor's email program
with the request filled in, so no request is lost. Note: a site served over **https** can only
send requests to an app that is also on **https**.
