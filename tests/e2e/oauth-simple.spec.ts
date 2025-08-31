import { test, expect } from '@playwright/test';

test.describe('OAuth Simple Test', () => {
  test('server starts with OAuth enabled', async ({ request }) => {
    // Test that server is running
    const health = await request.get('http://localhost:3000/health');
    expect(health.status()).toBe(200);
    
    const healthData = await health.json();
    expect(healthData.status).toBe('healthy');
  });

  test('rejects unauthorized requests', async ({ request }) => {
    const response = await request.post('http://localhost:3000/mcp', {
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {}
      }
    });
    
    expect(response.status()).toBe(401);
  });

  test('accepts authorized requests', async ({ request }) => {
    const response = await request.post('http://localhost:3000/mcp', {
      headers: {
        'Authorization': 'Bearer test-token-123'
      },
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {}
      }
    });
    
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.result.tools).toBeInstanceOf(Array);
  });
});