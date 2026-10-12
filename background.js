chrome.cookies.getAll({ domain: ".facebook.com" }, (cookies) => {
  console.log("Cookies retrieved:", cookies);
});