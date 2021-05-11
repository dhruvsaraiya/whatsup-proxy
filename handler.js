"use strict";
const axios = require("axios");
const redis = require("redis");
const { promisify } = require("util");
const redisPrefix = "WhatsUp:Proxy";
const { whatsupWidget } = require("whatsup-sdk");
const jwt = require("jsonwebtoken");

function getRedisKey(contactNumber) {
  return `${redisPrefix}:${contactNumber}`;
}

function getRedisClient() {
  return redis.createClient({
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    password: process.env.REDIS_PASSWORD,
  });
}

async function getAccessToken(params) {
  try {
    const res = await axios.post(
      `${process.env.WHATSUP_BASE_URL}/api/user/login`,
      params,
      {
        headers: {
          "content-type": "application/json",
          Authorization: `Basic ${process.env.WHATSUP_API_KEY}`,
        },
      }
    );
    return { data: res.data };
  } catch (e) {
    return { error: (e.response && e.response.data) || e.toString() };
  }
}

async function getAdminAccessToken() {
  const params = {
    name: "Dhruv",
    contact_number: process.env.DHRUV_CONTACT_NUMBER,
  };
  const { data, error } = await getAccessToken(params);
  if (error) return { error };
  return { accessToken: data.access_token };
}

function randomString(length) {
  var chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  var result = "";
  for (var i = length; i > 0; --i)
    result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

async function sendOtpViaAdmin(contactNumber, name, otp, client) {
  const aget = promisify(client.get).bind(client);
  const aset = promisify(client.set).bind(client);
  const adminRedisKey = `${redisPrefix}:Admin:Dhruv:AccessToken`;
  let adminAccessToken = await aget(adminRedisKey);
  if (!adminAccessToken) {
    const { accessToken, error } = await getAdminAccessToken();
    if (error) {
      console.log("[sendOtpViaAdmin][ERROR]", error);
      return;
    } else if (accessToken) {
      aset(adminRedisKey, accessToken, "EX", 15 * 60);
      adminAccessToken = accessToken;
    } else {
      console.log("[sendOtpViaAdmin]Weird");
      return;
    }
  }

  // Send Message via SDK
  await whatsupWidget.load({
    accessToken: adminAccessToken,
    name: "Dhruv",
    contactNumber: process.env.DHRUV_CONTACT_NUMBER,
  });
  // It is assumed that, Dhruv keeps his WhatsApp connected
  // Can't scan QRCode in this na...
  const msg = `
  Hi ${name},
  This is Dhruv,
  The OTP for your login to WhatsUp Demo APP :- *${otp}*
  Please dont share this with anyone, or else they may use your WhatsApp account.
  `;
  await whatsupWidget.sendTextMessage(`${contactNumber}@s.whatsapp.net`, msg);
  return;
}

function GenerateOtp(event, context, callback) {
  const body = JSON.parse(event.body);
  const contactNumber = (body.contactNumber || "").replace(/\+/g, "");
  const name = body.name;
  const otp =
    contactNumber === process.env.DHRUV_CONTACT_NUMBER
      ? process.env.OTP_FOR_DHRUV
      : randomString(10);

  const client = getRedisClient();
  // send OTP in async way
  sendOtpViaAdmin(contactNumber, name, otp, client);
  const aset = promisify(client.set).bind(client);
  aset(getRedisKey(contactNumber), otp, "EX", 15 * 60);

  callback(null, {
    statusCode: 200,
    headers: {
      "Access-Control-Allow-Origin": "*", // Required for CORS support to work
      "Access-Control-Allow-Credentials": true, // Required for cookies, authorization headers with HTTPS
      Authorization: true,
    },
  });
}

async function LoginToWhatsup(event, context, callback) {
  const headers = {
    "Access-Control-Allow-Origin": "*", // Required for CORS support to work
    "Access-Control-Allow-Credentials": true, // Required for cookies, authorization headers with HTTPS
    Authorization: true,
  };

  const body = JSON.parse(event.body);
  const contactNumber = (body.contactNumber || "").replace(/\+/g, "");
  const name = body.name;
  const otp = body.otp;
  if (!(contactNumber && name && otp)) {
    const errorResponse = {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        message: "Contact Number, Name, OTP is required",
      }),
    };
    callback(null, errorResponse);
    return;
  }

  const params = {
    contact_number: contactNumber,
    name,
  };

  const client = getRedisClient();
  const aget = promisify(client.get).bind(client);
  const redisOtp = await aget(getRedisKey(contactNumber));
  if (!redisOtp) {
    const errorResponse = {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        message: "OTP Expired",
      }),
    };
    callback(null, errorResponse);
    return;
  }
  if (redisOtp && otp && redisOtp.toString() !== otp.toString()) {
    const errorResponse = {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        message: "OTP Invalid",
      }),
    };
    callback(null, errorResponse);
    return;
  }

  const { data, error } = await getAccessToken(params);
  if (error) {
    const errorResponse = {
      statusCode: error.status,
      headers,
      body: JSON.stringify({
        message: error.title,
      }),
    };
    callback(null, errorResponse);
  } else if (data) {
    const whatsupProxyAccessToken = jwt.sign(
      {
        data: params,
      },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );
    console.log("process.env.JWT_SECRET => ", process.env.JWT_SECRET, {
      whatsupProxyAccessToken,
    });

    data["whatsupProxyAccessToken"] = whatsupProxyAccessToken;
    const response = {
      statusCode: 200,
      headers,
      body: JSON.stringify(data),
    };
    callback(null, response);
  }
}

async function ReLoginToWhatsup(event, context, callback) {
  const headers = {
    "Access-Control-Allow-Origin": "*", // Required for CORS support to work
    "Access-Control-Allow-Credentials": true, // Required for cookies, authorization headers with HTTPS
    Authorization: true,
  };

  const reqHeaders = event.headers;
  let auth = reqHeaders["Authorization"] || "";
  if (!auth) {
    const errorResponse = {
      statusCode: 401,
      headers,
      body: JSON.stringify({
        message: "Authorization is required",
      }),
    };
    callback(null, errorResponse);
    return;
  }

  auth = auth.split(" ");
  if (auth.length !== 2) {
    const errorResponse = {
      statusCode: 401,
      headers,
      body: JSON.stringify({
        message: "Invalid Authorization",
      }),
    };
    callback(null, errorResponse);
    return;
  }

  var decoded;
  try {
    decoded = jwt.verify(auth[1], process.env.JWT_SECRET);
  } catch (err) {
    console.log("[ReLoginToWhatsup][ERROR]", err);
    const errorResponse = {
      statusCode: 401,
      headers,
      body: JSON.stringify({
        message: err.toString(),
      }),
    };
    callback(null, errorResponse);
    return;
  }

  const params = {
    contact_number: decoded.data.contact_number,
    name: decoded.data.name,
  };

  const { data, error } = await getAccessToken(params);
  if (error) {
    const errorResponse = {
      statusCode: error.status,
      headers,
      body: JSON.stringify({
        message: error.title,
      }),
    };
    callback(null, errorResponse);
  } else if (data) {
    const response = {
      statusCode: 200,
      headers,
      body: JSON.stringify(data),
    };
    callback(null, response);
  }
}

module.exports.GenerateOtp = GenerateOtp;
module.exports.LoginToWhatsup = LoginToWhatsup;
module.exports.ReLoginToWhatsup = ReLoginToWhatsup;
