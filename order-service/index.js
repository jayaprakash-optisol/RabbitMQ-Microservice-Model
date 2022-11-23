require('dotenv').config();
const mongoose = require('mongoose');
const express = require('express');
const Order = require('./models/Order');
const amqp = require('amqplib');
const Logging = require('./utils/Logging');

const app = express();

let channel, connection, PORT, AMQP_SERVER_URL, MONGO_URL;

const NODE_ENV = process.env.NODE_ENV || 'development';

// TODO: Yet to write Custom Logic to load env from utils
NODE_ENV === 'production'
  ? ((PORT = process.env.PROD_PORT),
    (MONGO_URL = process.env.PROD_MONGO_URL),
    (AMQP_SERVER_URL = process.env.PROD_AMQP_SERVER_URL))
  : ((PORT = process.env.DEV_PORT),
    (MONGO_URL = process.env.DEV_MONGO_URL),
    (AMQP_SERVER_URL = process.env.DEV_AMQP_SERVER_URL));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

mongoose
  .connect(MONGO_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => Logging.info('Order-service Connected to MongoDB'))
  .catch((e) =>
    Logging.info(`Failed Connecting Order-service to MongoDB--> ${e}`)
  );

// Create an order
const createOrder = async (products) => {
  let total = 0;

  products.forEach((product) => {
    total += product.price;
  });

  const order = new Order({
    products,
    total,
  });
  await order.save();
  return order;
};

//RabbitMQ Connection - Order Service
const connectToRabbitMQ = async () => {
  const amqpServer = AMQP_SERVER_URL;
  connection = await amqp.connect(amqpServer);
  channel = await connection.createChannel();
  await channel.assertQueue('order-service-queue'); // Order Queue
};

connectToRabbitMQ()
  .then(() => {
    Logging.info('RabbitMQ Connected Successfully');
    channel.consume('order-service-queue', async (data) => {
      // order-service listens to this queue

      Logging.info(
        'Received products data from order-service-queue (Creating-Order...)'
      );
      const { products } = JSON.parse(data.content);

      const newOrder = await createOrder(products);
      channel.ack(data);

      // Forwards created order response in product-service-queue
      await channel.sendToQueue(
        'product-service-queue',
        Buffer.from(JSON.stringify({ newOrder }))
      );
    });
  })
  .catch((e) => {
    Logging.error('RabbitMQ Connection failed');
    throw new Error(e);
  });

app.listen(PORT, () => {
  Logging.info(`Order-Service listening on port --> : ${PORT}`);
});
