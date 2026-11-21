const https = require('https');
const http = require('http');
const { URL } = require('url');

/**
 * Clean and unwrap CDATA or trimmed string from an XML tag
 */
function cleanXmlContent(str) {
  if (!str) return '';
  return str.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1').trim();
}

/**
 * Parse time string "00:00:05" or "5" to seconds
 */
function parseTimeOffset(timeStr, fallback = 5) {
  if (!timeStr) return fallback;
  const clean = cleanXmlContent(timeStr);
  const parts = clean.split(':');
  if (parts.length === 3) {
    const hours = parseInt(parts[0], 10) || 0;
    const mins = parseInt(parts[1], 10) || 0;
    const secs = parseInt(parts[2], 10) || 0;
    return hours * 3600 + mins * 60 + secs;
  }
  const directSec = parseInt(clean, 10);
  return isNaN(directSec) ? fallback : directSec;
}

/**
 * Robust regex-based VAST XML parser
 */
function parseVastXml(xmlString) {
  const result = {
    wrapperUrl: null,
    impressions: [],
    mediaUrl: null,
    clickThrough: null,
    clickTracking: [],
    skipOffset: 5,
    duration: 15,
    title: 'DarkPAKI Sponsor Ad'
  };

  if (!xmlString || typeof xmlString !== 'string') {
    return result;
  }

  // Check Wrapper VASTAdTagURI
  const wrapperMatch = xmlString.match(/<VASTAdTagURI\b[^>]*>([\s\S]*?)<\/VASTAdTagURI>/i);
  if (wrapperMatch) {
    result.wrapperUrl = cleanXmlContent(wrapperMatch[1]);
  }

  // Linear skipoffset
  const skipMatch = xmlString.match(/skipoffset=["']([^"']+)["']/i);
  if (skipMatch) {
    result.skipOffset = parseTimeOffset(skipMatch[1], 5);
  }

  // AdTitle
  const titleMatch = xmlString.match(/<AdTitle\b[^>]*>([\s\S]*?)<\/AdTitle>/i);
  if (titleMatch) {
    result.title = cleanXmlContent(titleMatch[1]);
  }

  // Duration
  const durMatch = xmlString.match(/<Duration\b[^>]*>([\s\S]*?)<\/Duration>/i);
  if (durMatch) {
    result.duration = parseTimeOffset(durMatch[1], 15);
  }

  // Impressions
  const impRegex = /<Impression\b[^>]*>([\s\S]*?)<\/Impression>/gi;
  let imp;
  while ((imp = impRegex.exec(xmlString)) !== null) {
    const url = cleanXmlContent(imp[1]);
    if (url && !result.impressions.includes(url)) {
      result.impressions.push(url);
    }
  }

  // MediaFile: prioritize video/mp4 progressive
  const mediaRegex = /<MediaFile\b([^>]*)>([\s\S]*?)<\/MediaFile>/gi;
  let media;
  let fallbackMedia = null;
  while ((media = mediaRegex.exec(xmlString)) !== null) {
    const attrs = media[1] || '';
    const url = cleanXmlContent(media[2]);
    if (!url) continue;

    if (attrs.includes('video/mp4') || url.includes('.mp4')) {
      result.mediaUrl = url;
      break;
    } else if (!fallbackMedia) {
      fallbackMedia = url;
    }
  }
  if (!result.mediaUrl && fallbackMedia) {
    result.mediaUrl = fallbackMedia;
  }

  // ClickThrough
  const clickMatch = xmlString.match(/<ClickThrough\b[^>]*>([\s\S]*?)<\/ClickThrough>/i);
  if (clickMatch) {
    result.clickThrough = cleanXmlContent(clickMatch[1]);
  }

  // ClickTracking
  const clickTrackRegex = /<ClickTracking\b[^>]*>([\s\S]*?)<\/ClickTracking>/gi;
  let ct;
  while ((ct = clickTrackRegex.exec(xmlString)) !== null) {
    const url = cleanXmlContent(ct[1]);
    if (url && !result.clickTracking.includes(url)) {
      result.clickTracking.push(url);
    }
  }

  return result;
}

/**
 * Fetch URL with timeout and redirect following (native Node.js)
 */
function fetchXml(targetUrl, timeoutMs = 4500, maxRedirects = 4) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      return reject(new Error('Too many redirects'));
    }

    try {
      const parsed = new URL(targetUrl);
      const isHttps = parsed.protocol === 'https:';
      const client = isHttps ? https : http;

      const req = client.get(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          'Accept': 'application/xml, text/xml, */*'
        },
        timeout: timeoutMs
      }, (res) => {
        // Follow redirects (301, 302, 303, 307, 308)
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, targetUrl).toString();
          res.resume(); // Discard stream
          return resolve(fetchXml(redirectUrl, timeoutMs, maxRedirects - 1));
        }

        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          resolve({ status: res.statusCode, body });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('VAST request timed out'));
      });

      req.on('error', (err) => {
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Recursively resolve a VAST tag URL, following wrappers up to depth limit
 */
async function resolveVastTag(vastTagUrl, maxDepth = 3) {
  const aggregated = {
    impressions: [],
    clickTracking: [],
    mediaUrl: null,
    clickThrough: null,
    skipOffset: 5,
    duration: 15,
    title: 'DarkPAKI Sponsor Ad'
  };

  let currentUrl = vastTagUrl;
  let depth = 0;

  while (currentUrl && depth < maxDepth) {
    depth++;
    try {
      const resp = await fetchXml(currentUrl, 4500);
      if (resp.status !== 200 || !resp.body) {
        break;
      }

      const parsed = parseVastXml(resp.body);

      // Accumulate tracking and impressions
      if (parsed.impressions && parsed.impressions.length > 0) {
        parsed.impressions.forEach(u => {
          if (!aggregated.impressions.includes(u)) aggregated.impressions.push(u);
        });
      }
      if (parsed.clickTracking && parsed.clickTracking.length > 0) {
        parsed.clickTracking.forEach(u => {
          if (!aggregated.clickTracking.includes(u)) aggregated.clickTracking.push(u);
        });
      }

      if (parsed.mediaUrl) {
        aggregated.mediaUrl = parsed.mediaUrl;
      }
      if (parsed.clickThrough) {
        aggregated.clickThrough = parsed.clickThrough;
      }
      if (parsed.skipOffset) {
        aggregated.skipOffset = parsed.skipOffset;
      }
      if (parsed.duration) {
        aggregated.duration = parsed.duration;
      }
      if (parsed.title && parsed.title !== 'Sponsor Video') {
        aggregated.title = parsed.title;
      }

      // If MediaFile resolved, stop unwrapping
      if (aggregated.mediaUrl) {
        break;
      }

      // If wrapper exists, follow it
      if (parsed.wrapperUrl) {
        currentUrl = parsed.wrapperUrl;
      } else {
        break;
      }
    } catch (err) {
      console.warn(`[VAST Resolver] Error at depth ${depth} for ${currentUrl}:`, err.message);
      break;
    }
  }

  if (aggregated.mediaUrl) {
    return {
      success: true,
      ad: aggregated
    };
  }

  return {
    success: false,
    noFill: true,
    message: 'No active video ad creative found in VAST response'
  };
}

module.exports = {
  cleanXmlContent,
  parseTimeOffset,
  parseVastXml,
  resolveVastTag,
  fetchXml
};
