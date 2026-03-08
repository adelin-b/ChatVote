import { test, expect } from '../support/base-test';

const MOCK_TOPIC_STATS = {
  total_chunks: 450,
  classified_chunks: 380,
  unclassified_chunks: 70,
  themes: [
    {
      theme: 'environnement',
      count: 85,
      percentage: 18.9,
      by_party: { 'Les Écologistes': 30, 'Place Publique': 25, Renaissance: 15, LFI: 15 },
      by_source: { election_manifesto: 50, candidate_website_programme: 35 },
      by_fiabilite: { '1': 10, '2': 60, '3': 15 },
      sub_themes: ['biodiversité', 'énergie renouvelable', 'pollution'],
    },
    {
      theme: 'économie',
      count: 65,
      percentage: 14.4,
      by_party: { Renaissance: 35, LFI: 20, RN: 10 },
      by_source: { election_manifesto: 40, candidate_website_programme: 25 },
      by_fiabilite: { '1': 5, '2': 50, '3': 10 },
      sub_themes: ['emploi', 'fiscalité'],
    },
    {
      theme: 'sécurité',
      count: 45,
      percentage: 10.0,
      by_party: { RN: 25, Renaissance: 15, LR: 5 },
      by_source: { election_manifesto: 30, candidate_website_programme: 15 },
      by_fiabilite: { '2': 35, '3': 10 },
      sub_themes: ['police', 'justice'],
    },
  ],
  collections: {
    all_parties_dev: { total: 200, classified: 170 },
    candidates_websites_dev: { total: 250, classified: 210 },
  },
};

const MOCK_BERTOPIC = {
  status: 'success',
  total_messages: 120,
  num_topics: 4,
  topics: [
    {
      topic_id: -1,
      label: 'Outliers',
      count: 20,
      percentage: 16.7,
      words: [],
      representative_messages: [],
      by_party: {},
    },
    {
      topic_id: 0,
      label: '0_climat_environnement_pollution',
      count: 40,
      percentage: 33.3,
      words: [
        { word: 'climat', weight: 0.15 },
        { word: 'environnement', weight: 0.12 },
        { word: 'pollution', weight: 0.09 },
      ],
      representative_messages: [
        { text: 'Que proposez-vous pour le climat ?', session_id: 's1', chat_title: 'Climat' },
        { text: 'Quelles mesures contre la pollution ?', session_id: 's2', chat_title: 'Pollution' },
      ],
      by_party: { 'Les Écologistes': 15, Renaissance: 10 },
    },
    {
      topic_id: 1,
      label: '1_emploi_économie_chômage',
      count: 35,
      percentage: 29.2,
      words: [
        { word: 'emploi', weight: 0.14 },
        { word: 'économie', weight: 0.11 },
      ],
      representative_messages: [
        { text: 'Comment relancer l\'emploi ?', session_id: 's3', chat_title: 'Emploi' },
      ],
      by_party: { Renaissance: 20, LFI: 10 },
    },
    {
      topic_id: 2,
      label: '2_sécurité_police_justice',
      count: 25,
      percentage: 20.8,
      words: [
        { word: 'sécurité', weight: 0.13 },
        { word: 'police', weight: 0.10 },
      ],
      representative_messages: [
        { text: 'Que proposez-vous pour la sécurité ?', session_id: 's4', chat_title: 'Sécurité' },
      ],
      by_party: { RN: 15, LR: 5 },
    },
  ],
};

test.describe('Topic Insights Page', () => {
  test.beforeEach(async ({ page, expectedErrors }) => {
    // HMR websocket errors are expected in test environment
    expectedErrors.push(/webpack-hmr/);

    // Intercept the backend API calls with mock data
    await page.route('**/api/experiment/topics', (route) =>
      route.fulfill({ json: MOCK_TOPIC_STATS }),
    );
    await page.route('**/api/experiment/bertopic', (route) =>
      route.fulfill({ json: MOCK_BERTOPIC }),
    );
  });

  test('page loads and shows header', async ({ page }) => {
    await page.goto('/experiment/topics');
    await expect(page.getByRole('heading', { name: 'Topic Insights' })).toBeVisible();
    await expect(page.getByText('Explore themes in the knowledge base')).toBeVisible();
  });

  test('shows summary stat cards', async ({ page }) => {
    await page.goto('/experiment/topics');
    await expect(page.getByText('450')).toBeVisible(); // Total Chunks
    await expect(page.getByText('380')).toBeVisible(); // Classified
    await expect(page.getByText('70', { exact: true })).toBeVisible();  // Unclassified
  });

  test('shows collection breakdown', async ({ page }) => {
    await page.goto('/experiment/topics');
    await expect(page.getByText('all_parties_dev')).toBeVisible();
    await expect(page.getByText('candidates_websites_dev')).toBeVisible();
    await expect(page.getByText('170/200 classified')).toBeVisible();
    await expect(page.getByText('210/250 classified')).toBeVisible();
  });

  test('shows distribution bar chart with themes', async ({ page }) => {
    await page.goto('/experiment/topics');
    await expect(page.getByText('Distribution')).toBeVisible();
    await expect(page.getByText('environnement').first()).toBeVisible();
    await expect(page.getByText('économie').first()).toBeVisible();
    await expect(page.getByText('sécurité').first()).toBeVisible();
  });

  test('theme cards are expandable', async ({ page }) => {
    await page.goto('/experiment/topics');

    // Theme details section should exist
    await expect(page.getByText('Theme Details')).toBeVisible();

    // Click first theme card to expand it
    const firstCard = page.locator('button', { hasText: 'environnement' }).first();
    await firstCard.click();

    // After expanding, party breakdown should be visible
    await expect(page.getByText('By Party / Namespace')).toBeVisible();
    await expect(page.getByText('Les Écologistes').first()).toBeVisible();

    // Sub-themes should be visible
    await expect(page.getByText('Sub-themes')).toBeVisible();
    await expect(page.getByText('biodiversité')).toBeVisible();
  });

  test('shows unclassified chunks section', async ({ page }) => {
    await page.goto('/experiment/topics');
    await expect(page.getByText('Unclassified Chunks')).toBeVisible();
    await expect(page.getByText(/70 chunks.*have no theme assigned/)).toBeVisible();
  });

  test('navigation link to Chunk Explorer exists', async ({ page }) => {
    await page.goto('/experiment/topics');
    const link = page.getByRole('link', { name: 'Chunk Explorer' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/experiment');
  });

  // ── BERTopic tab ──

  test('BERTopic tab shows run button initially', async ({ page }) => {
    await page.goto('/experiment/topics');

    // Switch to BERTopic tab
    await page.getByRole('button', { name: /BERTopic/i }).click();

    // Should show the run analysis button
    await expect(page.getByText('BERTopic Clustering')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run Analysis' })).toBeVisible();
  });

  test('BERTopic tab shows results after analysis', async ({ page }) => {
    await page.goto('/experiment/topics');

    // Switch to BERTopic tab
    await page.getByRole('button', { name: /BERTopic/i }).click();

    // Click Run Analysis
    await page.getByRole('button', { name: 'Run Analysis' }).click();

    // Wait for results to render
    await expect(page.getByText('User Messages')).toBeVisible();
    await expect(page.getByText('120')).toBeVisible(); // total messages
    await expect(page.getByText('Topics Discovered')).toBeVisible();

    // Bar chart should show topics
    await expect(page.getByText('Topic Distribution')).toBeVisible();
    await expect(page.getByText(/climat_environnement/).first()).toBeVisible();
    await expect(page.getByText(/emploi_économie/).first()).toBeVisible();
  });

  test('BERTopic topic cards expand with keywords and messages', async ({ page }) => {
    await page.goto('/experiment/topics');
    await page.getByRole('button', { name: /BERTopic/i }).click();
    await page.getByRole('button', { name: 'Run Analysis' }).click();

    // Wait for topic cards
    await expect(page.getByText('Topic Details')).toBeVisible();

    // Expand first non-outlier topic card
    const topicCard = page.locator('button', { hasText: 'Topic 0' }).first();
    await topicCard.click();

    // Keywords should be visible
    await expect(page.getByText('Keywords')).toBeVisible();
    await expect(page.getByText('climat').first()).toBeVisible();

    // Representative messages should be visible
    await expect(page.getByText('Representative Messages')).toBeVisible();
    await expect(page.getByText('Que proposez-vous pour le climat ?')).toBeVisible();

    // Party distribution
    await expect(page.getByText('Parties Discussed')).toBeVisible();
  });

  test('tab switching preserves state', async ({ page }) => {
    await page.goto('/experiment/topics');

    // Verify taxonomy tab is shown by default
    await expect(page.getByText('Total Chunks')).toBeVisible();

    // Switch to BERTopic
    await page.getByRole('button', { name: /BERTopic/i }).click();
    await expect(page.getByText('BERTopic Clustering')).toBeVisible();

    // Switch back to taxonomy
    await page.getByRole('button', { name: /Fixed Taxonomy/i }).click();
    await expect(page.getByText('Total Chunks')).toBeVisible();
  });
});

test.describe('Experiment Playground → Topic Insights Navigation', () => {
  test.beforeEach(async ({ page, expectedErrors }) => {
    expectedErrors.push(/webpack-hmr/);

    // Mock the schema endpoint so experiment playground loads
    await page.route('**/api/experiment/schema', (route) =>
      route.fulfill({
        json: {
          themes: ['environnement', 'économie'],
          fiabilite_levels: { '1': 'GOVERNMENT', '2': 'OFFICIAL' },
          namespaces: ['renaissance'],
          nuances_politiques: [],
          collections: ['parties', 'candidates'],
        },
      }),
    );
  });

  test('experiment playground has link to Topic Insights', async ({ page }) => {
    await page.goto('/experiment');
    const link = page.getByRole('link', { name: 'Topic Insights' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/experiment/topics');
  });
});
