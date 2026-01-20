import { createRouter, createWebHistory } from 'vue-router';

const routes = [
  {
    path: '/',
    redirect: '/order'
  },
  {
    path: '/order',
    name: 'order',
    component: () => import('../views/OrderView.vue')
  },
  {
    path: '/payment',
    name: 'payment',
    component: () => import('../views/PaymentMethodView.vue')
  },
  {
    path: '/payment-instruction',
    name: 'payment-instruction',
    component: () => import('../views/PaymentInstructionView.vue')
  }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});

export default router;
