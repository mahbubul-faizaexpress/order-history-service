'use strict';

const { Router } = require('express');
const { requireAuth } = require('../auth');
const { getUserOrders } = require('./controller');

const router = Router();

router.get('/users/:id/orders', requireAuth, getUserOrders);

module.exports = router;
