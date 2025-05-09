/**
 * Download content from URL with improved error handling and timeouts
 * 
 * @param {string} url - URL to download
 * @param {Object} options - Download options
 * @param {number} [options.timeout=30000] - Timeout in milliseconds
 * @param {boolean} [options.validateContentType=true] - Whether to validate content type
 * @param {boolean} [options.followRedirects=true] - Whether to follow redirects
 * @param {number} [options.maxRedirects=5] - Maximum number of redirects to follow
 * @returns {Promise<Buffer>} - Downloaded content as buffer
 */
async function downloadContent(url, options = {}) {
    const {
        timeout = 30000,
        validateContentType = true,
        followRedirects = true,
        maxRedirects = 5
    } = options;
    
    // Choose http or https based on URL
    const httpModule = url.startsWith('https') ? require('https') : require('http');
    
    return new Promise((resolve, reject) => {
        const requestOptions = new URL(url);
        
        // Add timeout and other options
        requestOptions.timeout = timeout;
        
        const req = httpModule.get(requestOptions, (res) => {
            // Handle redirects
            if (followRedirects && (res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
                if (maxRedirects <= 0) {
                    reject(new Error('Too many redirects'));
                    return;
                }
                
                // Follow redirect
                return downloadContent(res.headers.location, {
                    ...options,
                    maxRedirects: maxRedirects - 1
                }).then(resolve).catch(reject);
            }
            
            // Check status code
            if (res.statusCode !== 200) {
                reject(new Error(`Request failed with status code ${res.statusCode}`));
                return;
            }
            
            // Validate content type if needed
            if (validateContentType) {
                const contentType = res.headers['content-type'] || '';
                if (!contentType.includes('image/') && 
                    !contentType.includes('video/') && 
                    !contentType.includes('audio/') && 
                    !contentType.includes('application/')) {
                    reject(new Error(`Invalid content type: ${contentType}`));
                    return;
                }
            }
            
            // Collect data
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
        });
        
        // Handle request errors
        req.on('error', (err) => reject(err));
        
        // Handle timeout
        req.on('timeout', () => {
            req.destroy();
            reject(new Error(`Request timeout after ${timeout}ms`));
        });
        
        // End request
        req.end();
    });
}
