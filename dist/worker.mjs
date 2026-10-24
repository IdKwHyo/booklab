import { experiment } from './engine.mjs';
self.onmessage = ({ data }) => {
  try {
    const result = experiment(data.dataset, data.config, message => self.postMessage({ type: 'progress', message }));
    self.postMessage({ type: 'result', result });
  } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
};
