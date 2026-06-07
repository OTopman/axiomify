import { ApiClient } from './sdk';

const client = new ApiClient({
  baseUrl: 'http://localhost:3000', // Points to the running app
});

(async () => {
  try {
    // Example call:
const result = await client.getLiveFeed();
console.log('Result:', result);

  } catch (error) {
    console.error('API Error:', error);
  }
})();
