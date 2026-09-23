import test from 'node:test';
import assert from 'node:assert/strict';
import { upcomingEvents, activityLabel, matchesHistory } from './adminPresentation.js';
test('upcoming dates exclude invalid, past and cancelled renewals', () => {
  const now = new Date('2026-09-23T12:00:00Z');
  const events = upcomingEvents([
    {id:'trial', subscriptionStatus:'trialing', trialEndsAt:'2026-09-27T20:00:00Z'},
    {id:'old', subscriptionStatus:'trialing', trialEndsAt:'2026-09-01'},
    {id:'invalid', subscriptionStatus:'trialing', trialEndsAt:'bad'},
    {id:'cancelled', subscriptionStatus:'active', currentPeriodEnd:'2026-09-24', cancelAtPeriodEnd:true},
    {id:'missing', subscriptionStatus:'active'},
  ], now);
  assert.equal(events.length, 3);
  assert.ok(events.every(event => event.familyId === 'trial'));
  assert.equal(events.filter(event => event.estimated).length, 2);
  assert.equal(events.at(-1).label, 'Trial ends');
});
test('history filters distinguish email failures from payment failures', () => {
  assert.equal(matchesHistory({eventType:'payment_failed'}, 'failed'), false);
  assert.equal(matchesHistory({eventType:'trial_reminder_email_failed',metadata:{deliveryStatus:'failed'}}, 'failed'), true);
  assert.equal(matchesHistory({eventType:'trial_reminder_email_sent'}, 'subscriptions'), false);
  assert.equal(matchesHistory({eventType:'refund_succeeded'}, 'payments'), true);
  assert.equal(activityLabel('platform_family_soft_deleted'), 'Family archived');
});
