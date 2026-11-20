import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CORE_GOLD_NEWS_SOURCES,
  aggregateNewsIntelligence,
  parseForexFactoryEvents,
  parseRssXmlHeadlines,
  scoreGoldHeadline,
} from './newsIntelligence.ts';

test('CORE_GOLD_NEWS_SOURCES registers all 14 authoritative gold-moving websites across 4 tiers', () => {
  assert.equal(CORE_GOLD_NEWS_SOURCES.length, 14);
  const tiers = new Set(CORE_GOLD_NEWS_SOURCES.map((s) => s.tier));
  assert.ok(tiers.has('CENTRAL_BANK'));
  assert.ok(tiers.has('MACRO_AGENCY'));
  assert.ok(tiers.has('CALENDAR_WIRE'));
  assert.ok(tiers.has('METALS_INSTITUTIONAL'));

  const ids = new Set(CORE_GOLD_NEWS_SOURCES.map((s) => s.id));
  assert.ok(ids.has('us-fed-press'));
  assert.ok(ids.has('us-bls'));
  assert.ok(ids.has('us-bea'));
  assert.ok(ids.has('ecb-press'));
  assert.ok(ids.has('boe-news'));
  assert.ok(ids.has('forexfactory-cal'));
  assert.ok(ids.has('fxstreet-wire'));
  assert.ok(ids.has('kitco-gold'));
  assert.ok(ids.has('cme-fedwatch'));
  assert.ok(ids.has('world-gold-council'));
});

test('scoreGoldHeadline distinguishes Bullish Gold, Bearish Gold, and Emergency Shock headlines', () => {
  const fed = CORE_GOLD_NEWS_SOURCES[0];
  const now = Date.now();

  const bullish = scoreGoldHeadline(
    'Federal Reserve signals dovish rate cut as US CPI cools and yields fall',
    'https://federalreserve.gov/a',
    now,
    fed
  );
  assert.equal(bullish.goldBias, 'BULLISH_GOLD');
  assert.equal(bullish.isEmergencyShock, false);
  assert.ok(bullish.impactScore >= 75);

  const bearish = scoreGoldHeadline(
    'Hawkish Fed warns of rate hike after hot CPI beats and dollar surges',
    'https://federalreserve.gov/b',
    now,
    fed
  );
  assert.equal(bearish.goldBias, 'BEARISH_GOLD');
  assert.equal(bearish.isEmergencyShock, false);

  const shock = scoreGoldHeadline(
    'BREAKING: Federal Reserve calls unscheduled FOMC emergency rate action after bank failure',
    'https://federalreserve.gov/c',
    now,
    fed
  );
  assert.equal(shock.isEmergencyShock, true);
  assert.ok(shock.matchedDrivers.includes('EMERGENCY SHOCK'));
});

test('parseRssXmlHeadlines parses CDATA RSS items and filters irrelevant non-macro items', () => {
  const kitco = CORE_GOLD_NEWS_SOURCES.find((s) => s.id === 'kitco-gold')!;
  const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
  <rss version="2.0"><channel>
    <item>
      <title><![CDATA[Gold surges to record high as central banks buy bullion &amp; yields fall]]></title>
      <link>https://www.kitco.com/news/gold-record</link>
      <pubDate>Wed, 18 Nov 2026 12:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Local sports team wins championship trophy</title>
      <link>https://example.com/sports</link>
    </item>
  </channel></rss>`;

  const parsed = parseRssXmlHeadlines(sampleXml, kitco, 5);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].goldBias, 'BULLISH_GOLD');
  assert.ok(parsed[0].title.includes('Gold surges'));
});

test('parseForexFactoryEvents extracts USD High/Medium upcoming releases only', () => {
  const now = Date.now();
  const sample = [
    { title: 'US Core CPI m/m', country: 'USD', impact: 'High', date: new Date(now + 1800_000).toISOString(), forecast: '0.2%', previous: '0.3%' },
    { title: 'EUR Retail Sales', country: 'EUR', impact: 'High', date: new Date(now + 1800_000).toISOString(), forecast: '0.1%', previous: '0.0%' },
    { title: 'US Minor Speech', country: 'USD', impact: 'Low', date: new Date(now + 1800_000).toISOString(), forecast: '', previous: '' },
  ];
  const events = parseForexFactoryEvents(sample, now);
  assert.equal(events.length, 1);
  assert.equal(events[0].title, 'US Core CPI m/m');
  assert.equal(events[0].impact, 'HIGH');
});

test('aggregateNewsIntelligence elevates GEOPOLITICAL_SHOCK when recent emergency headline exists', () => {
  const now = Date.now();
  const fed = CORE_GOLD_NEWS_SOURCES[0];
  const shock = scoreGoldHeadline('Emergency rate intervention after sudden missile strike', fed.url, now - 60_000, fed);
  const intel = aggregateNewsIntelligence({
    sources: CORE_GOLD_NEWS_SOURCES.map((s) => ({ ...s, status: s.feedUrl ? 'ONLINE' : 'REFERENCE' })),
    headlines: [shock],
    calendarEvents: [],
    calendarSource: 'LOCAL_SCHEDULE',
    fetchedAtMs: now,
  });

  assert.equal(intel.shockDetected, true);
  assert.equal(intel.macroSentiment, 'GEOPOLITICAL_SHOCK');
  assert.equal(intel.totalSourceCount, 14);
  assert.ok(intel.liveSourceCount >= 10);
});
