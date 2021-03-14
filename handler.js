"use strict";
const axios = require("axios");

function loginToWhatsup(event, context, callback) {
  const body = JSON.parse(event.body);
  const params = {
    contact_number: body.contactNumber,
    name: body.name,
  };

  axios
    .post(`${process.env.WHATSUP_BASE_URL}/api/user/login`, params, {
      headers: {
        "content-type": "application/json",
        Authorization: `Basic ${process.env.WHATSUP_API_KEY}`,
      },
    })
    .then(function (e) {
      const response = {
        statusCode: 200,
        headers: {
          "Access-Control-Allow-Origin": "*", // Required for CORS support to work
          "Access-Control-Allow-Credentials": true, // Required for cookies, authorization headers with HTTPS
          Authorization: true,
        },
        body: JSON.stringify(e.data),
      };
      callback(null, response);
    })
    .catch((e) => {
      const error = e.response.data;
      const errorResponse = {
        statusCode: error.status,
        headers: {
          "Access-Control-Allow-Origin": "*", // Required for CORS support to work
          "Access-Control-Allow-Credentials": true, // Required for cookies, authorization headers with HTTPS
          Authorization: true,
        },
        body: JSON.stringify({
          message: error.title,
        }),
      };
      callback(null, errorResponse);
    });
}

module.exports.loginToWhatsup = loginToWhatsup;
