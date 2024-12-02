// index.js

// 导入必要的模块
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mongoose = require('mongoose');

// 导入 nodemailer 用于发送邮件
const nodemailer = require('nodemailer');

const app = express();
const port = process.env.PORT || 3000;

// 使用您的 MongoDB 连接字符串
const mongoURI = 'mongodb+srv://bikesoftUser:bikesoftUser@bikesoft.fvtya.mongodb.net/?retryWrites=true&w=majority&appName=bikesoft';

// 连接到 MongoDB Atlas
mongoose.connect(mongoURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
  .then(() => console.log('MongoDB connected...'))
  .catch(err => console.log('MongoDB connection error:', err));

// 定义位置数据模型
const locationSchema = new mongoose.Schema({
  latitude: Number,
  longitude: Number,
  timestamp: { type: Date, default: Date.now }
});

const Location = mongoose.model('Location', locationSchema);

const CLEAR_PASSWORD = '123456'; // 替换为实际的密码

app.post('/clear-locations', async (req, res) => {
  const { password } = req.body;
  if (password !== CLEAR_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    await Location.deleteMany({});
    res.json({ message: 'All locations have been cleared.' });
    console.log('All location data has been cleared from the database.');
  } catch (err) {
    console.error('Error clearing locations:', err);
    res.status(500).json({ error: 'Error clearing locations.' });
  }
});

// 存储最新的位置信息
let latestLocation = { latitude: null, longitude: null };

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// 启用 CORS，允许来自您的前端页面的请求
app.use(cors({
  origin: 'https://zijuncui02.github.io' // 请将此处替换为您的 GitHub Pages 网址
}));

// 根路径，显示欢迎信息
app.get('/', (req, res) => {
  res.send('Welcome to Bikesoft Backend API! Use /location to get the latest bike coordinates.');
});

// 配置邮件传输器
const transporter = nodemailer.createTransport({
  host: 'smtp.163.com',
  port: 465, // 使用 SSL 连接
  secure: true, // 对于端口 465，secure 应该为 true
  auth: {
    user: '2630441087@qq.com', // 您的 163 邮箱地址
    pass: 'yplkyzwwvjxwebff'   // 您的 SMTP 专用密码
  }
});
console.log('SendGrid API Key 已加载：', process.env.SENDGRID_API_KEY ? '是' : '否');

// 发送邮件通知的函数
function sendEmailNotification(latitude, longitude, timestamp) {
  const mailOptions = {
    from: '2630441087@qq.com', // 您的 163 邮箱地址
    to: 'HRosenbloom2@outlook.com', // 收件人地址
    subject: 'New Location from EZ-Alarm',
    text: `New Location has been received：
  Latitude：${latitude}
  Longitude：${longitude}
  Timestamp：${timestamp}`
  };

  transporter.sendMail(mailOptions, function(error, info){
    if (error) {
      console.log('email error：', error);
    } else {
      console.log('email has been sent：', info.response);
    }
  });
}

// 接收来自 Twilio 的短信
app.post('/sms', (req, res) => {
  const from = req.body.From;
  const body = req.body.Body;

  console.log(`Received SMS from ${from}: ${body}`);

  // 使用正则表达式解析 GPS 坐标
  const gpsRegex = /GPS:\s*([-+]?[0-9]*\.?[0-9]+),\s*([-+]?[0-9]*\.?[0-9]+)/i;
  const match = body.match(gpsRegex);

  if (match) {
    const latitude = parseFloat(match[1]);
    const longitude = parseFloat(match[2]);

    console.log(`Parsed coordinates: Latitude ${latitude}, Longitude ${longitude}`);

    // 更新最新的位置信息
    latestLocation = { latitude, longitude };

    // 创建新的 Location 文档并保存到数据库
    const newLocation = new Location({ latitude, longitude });
    newLocation.save()
      .then(() => {
        console.log('Location saved to database');
        // 位置保存成功后，发送邮件通知
        sendEmailNotification(latitude, longitude, new Date().toISOString());
      })
      .catch(err => console.log('Error saving location:', err));

    // 响应 Twilio，必须返回合法的 XML
    res.set('Content-Type', 'text/xml');
    res.send('<Response></Response>');
  } else {
    console.log('No GPS coordinates found in the message.');
    res.set('Content-Type', 'text/xml');
    res.send('<Response></Response>');
  }
});

// 提供前端获取所有位置信息的接口，包括预测位置
app.get('/location', async (req, res) => {
  try {
    // 查询所有位置点，按时间升序排列
    let locations = await Location.find().sort({ timestamp: 1 });

    let predictedLocation = null;

    if (locations.length >= 2) {
      // 取最后两个点
      const len = locations.length;
      const loc1 = locations[len - 2];
      const loc2 = locations[len - 1];

      // 计算时间差（秒）
      const timeDiff = (loc2.timestamp - loc1.timestamp) / 1000;

      // 计算距离（米）
      const distance = getDistanceFromLatLonInMeters(
        loc1.latitude,
        loc1.longitude,
        loc2.latitude,
        loc2.longitude
      );

      // 计算速度（米/秒）
      const speed = distance / timeDiff;

      // 计算方位角
      const bearing = getBearing(
        loc1.latitude,
        loc1.longitude,
        loc2.latitude,
        loc2.longitude
      );

      // 预测下一个位置
      const predictedPoint = destinationPoint(
        loc2.latitude,
        loc2.longitude,
        speed * timeDiff,
        bearing
      );

      predictedLocation = {
        latitude: predictedPoint.latitude,
        longitude: predictedPoint.longitude,
        timestamp: new Date(loc2.timestamp.getTime() + timeDiff * 1000),
      };
    }

    res.json({ locations, predictedLocation });
  } catch (err) {
    res.status(500).json({ error: 'Error fetching locations' });
  }
});

// 计算两个经纬度之间的距离（米）
function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // 地球半径（米）
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  return distance;
}

// 计算两个点之间的方位角（度）
function getBearing(lat1, lon1, lat2, lon2) {
  const dLon = deg2rad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(deg2rad(lat2));
  const x = Math.cos(deg2rad(lat1)) * Math.sin(deg2rad(lat2)) -
            Math.sin(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.cos(dLon);
  const brng = rad2deg(Math.atan2(y, x));
  return (brng + 360) % 360;
}

// 根据起点、距离和方位角计算目的地经纬度
function destinationPoint(lat, lon, distance, bearing) {
  const R = 6371000; // 地球半径（米）
  const angularDistance = distance / R;
  const bearingRad = deg2rad(bearing);

  const lat1 = deg2rad(lat);
  const lon1 = deg2rad(lon);

  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angularDistance) +
                         Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearingRad));

  const lon2 = lon1 + Math.atan2(Math.sin(bearingRad) * Math.sin(angularDistance) * Math.cos(lat1),
                                 Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2));

  return {
    latitude: rad2deg(lat2),
    longitude: rad2deg(lon2)
  };
}

function deg2rad(deg) {
  return deg * (Math.PI/180);
}

function rad2deg(rad) {
  return rad * (180/Math.PI);
}

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
