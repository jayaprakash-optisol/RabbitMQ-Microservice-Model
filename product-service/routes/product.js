require('dotenv').config();
const { Router } = require('express');
const amqp = require('amqplib');
const Product = require('../models/Product');
const Logging = require('../utils/Logging');

const router = new Router();

const NODE_ENV = process.env.NODE_ENV || 'development';
const AMQP_SERVER_URL =
  NODE_ENV === 'production'
    ? process.env.PROD_AMQP_SERVER_URL
    : process.env.DEV_AMQP_SERVER_URL;

let order, channel, connection;

// Connect to RabbitMQ - Product Service
const connectToRabbitMQ = async () => {
  const amqpServer = AMQP_SERVER_URL; // RabbitMQ server
  connection = await amqp.connect(amqpServer);
  channel = await connection.createChannel(); // Channel for sending AMQP commands to broker
  await channel.assertQueue('product-service-queue'); // Queue
};

connectToRabbitMQ()
  .then(() => {
    Logging.info('RabbitMQ Connected Successfully');
  })
  .catch((e) => {
    Logging.error('RabbitMQ Connection failed');
    throw new Error(e);
  });

// Create a new product
router.post('/', async (req, res) => {
  const { name, price, description } = req.body;

  if (!name || !price || !description) {
    Logging.error('Please provide name, price and description');
    return res.status(400).json({
      message: 'Please provide name, price and description',
    });
  }

  try {
    const product = await new Product({ ...req.body });
    await product.save();
    return res.status(201).json({
      message: 'Product created successfully',
      product,
    });
  } catch (error) {
    return res.status(400).json({
      message: 'Error while creating product',
      error,
    });
  }
});

// API: Buying a product
router.post('/buy', async (req, res) => {
  const { productIds } = req.body;

  const products = await Product.find({ _id: { $in: productIds } });

  // Send order details to order-queue.
  channel.sendToQueue(
    'order-service-queue',
    Buffer.from(JSON.stringify({ products }))
  );

  // Listener: Fetches placed orders sent from order-queue & ACK the transaction.
  channel.consume('product-service-queue', (data) => {
    Logging.info(
      'Received ordered data from product-service-queue (Order-Placed Successfully 👍)'
    );
    order = JSON.parse(data.content);
    channel.ack(data);
  });

  return res.status(201).json({
    message: 'Order placed successfully',
    order,
  });
});

module.exports = router;
