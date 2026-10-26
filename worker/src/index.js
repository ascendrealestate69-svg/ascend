const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const MANAGED_FILES = new Set(['properties.json', 'logo.json']);
const ALLOWED_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);

export default {
    async fetch(request, env) {
        const origin = request.headers.get('Origin');
        const allowedOrigins = (env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
        if (origin && !allowedOrigins.includes(origin)) {
            return jsonResponse({ error: 'Origin is not allowed.' }, 403);
        }

        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 204,
                headers: corsHeaders(origin)
            });
        }

        try {
            const url = new URL(request.url);
            if (url.pathname === '/api/session' && request.method === 'GET') {
                requireAdmin(request, env);
                return jsonResponse({ ok: true }, 200, origin);
            }
            if (url.pathname === '/api/leads' && request.method === 'POST') {
                return await createLead(request, env, origin);
            }
            if (url.pathname === '/api/leads' && request.method === 'GET') {
                requireAdmin(request, env);
                const result = await env.DB.prepare(
                    'SELECT id, name, phone, property_type AS type, area, created_at AS date FROM leads ORDER BY id DESC LIMIT 500'
                ).all();
                return jsonResponse({ leads: result.results }, 200, origin);
            }
            if (url.pathname === '/api/images' && request.method === 'POST') {
                requireAdmin(request, env);
                return await uploadImage(request, env, origin);
            }
            if (url.pathname.startsWith('/api/files/') && request.method === 'GET') {
                requireAdmin(request, env);
                const filePath = decodeURIComponent(url.pathname.slice('/api/files/'.length));
                if (filePath !== 'properties.json') return jsonResponse({ error: 'File is not readable by this endpoint.' }, 404, origin);
                return await readSiteFile(env, filePath, origin);
            }
            if (url.pathname.startsWith('/api/files/') && request.method === 'PUT') {
                requireAdmin(request, env);
                const filePath = decodeURIComponent(url.pathname.slice('/api/files/'.length));
                if (!MANAGED_FILES.has(filePath)) return jsonResponse({ error: 'File is not managed by this endpoint.' }, 404, origin);
                return await updateSiteFile(request, env, filePath, origin);
            }
            return jsonResponse({ error: 'Not found.' }, 404, origin);
        } catch (error) {
            const status = error.status || 500;
            if (status === 500) console.error(error);
            return jsonResponse({ error: status === 500 ? 'The request could not be completed.' : error.message }, status, origin);
        }
    }
};

function corsHeaders(origin) {
    const headers = new Headers({
        'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin'
    });
    if (origin) headers.set('Access-Control-Allow-Origin', origin);
    return headers;
}

function jsonResponse(body, status = 200, origin = null) {
    const headers = new Headers(JSON_HEADERS);
    corsHeaders(origin).forEach((value, key) => headers.set(key, value));
    return new Response(JSON.stringify(body), { status, headers });
}

function requireAdmin(request, env) {
    const expected = env.ADMIN_PASSWORD;
    const supplied = request.headers.get('X-Admin-Password') || '';
    if (!expected || !constantTimeEqual(supplied, expected)) {
        const error = new Error('كلمة المرور غير صحيحة أو إعدادات الإدارة غير مكتملة.');
        error.status = 401;
        throw error;
    }
}

function constantTimeEqual(left, right) {
    const encoder = new TextEncoder();
    const leftBytes = encoder.encode(left);
    const rightBytes = encoder.encode(right);
    let difference = leftBytes.length ^ rightBytes.length;
    const length = Math.max(leftBytes.length, rightBytes.length);
    for (let index = 0; index < length; index++) {
        difference |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
    }
    return difference === 0;
}

async function parseJson(request) {
    const contentLength = Number(request.headers.get('Content-Length') || 0);
    if (contentLength > 8_000_000) {
        const error = new Error('Request body is too large.');
        error.status = 413;
        throw error;
    }
    let body;
    try {
        body = await request.json();
    } catch {
        const error = new Error('Invalid JSON request.');
        error.status = 400;
        throw error;
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        const error = new Error('The request body must be a JSON object.');
        error.status = 400;
        throw error;
    }
    return body;
}

async function createLead(request, env, origin) {
    const body = await parseJson(request);
    const name = cleanText(body.name, 100, 'name');
    const phone = cleanText(body.phone, 30, 'phone');
    const type = cleanText(body.type, 100, 'type');
    const area = cleanText(body.area, 120, 'area');
    await env.DB.prepare(
        'INSERT INTO leads (name, phone, property_type, area) VALUES (?, ?, ?, ?)'
    ).bind(name, phone, type, area).run();
    return jsonResponse({ ok: true }, 201, origin);
}

function cleanText(value, maxLength, field) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
        const error = new Error(`Invalid ${field}.`);
        error.status = 400;
        throw error;
    }
    return value.trim();
}

async function updateSiteFile(request, env, filePath, origin) {
    const body = await parseJson(request);
    if (!body.content || typeof body.content !== 'object') {
        return jsonResponse({ error: 'Invalid file content.' }, 400, origin);
    }
    if (filePath === 'properties.json') {
        const validationError = validateProperties(body.content);
        if (validationError) return jsonResponse({ error: validationError }, 400, origin);
    }
    if (filePath === 'logo.json') {
        const logoUrl = body.content.logoUrl;
        if (typeof logoUrl !== 'string' || (logoUrl && !isHttpsUrl(logoUrl))) {
            return jsonResponse({ error: 'Logo data is invalid.' }, 400, origin);
        }
    }
    const message = typeof body.message === 'string' ? body.message.slice(0, 120) : `Update ${filePath}`;
    await writeGitHubFile(env, filePath, new TextEncoder().encode(JSON.stringify(body.content, null, 2)), message);
    return jsonResponse({ ok: true }, 200, origin);
}

async function readSiteFile(env, filePath, origin) {
    if (!env.GITHUB_TOKEN) {
        const error = new Error('GitHub access is not configured on the Worker.');
        error.status = 503;
        throw error;
    }
    const apiUrl = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${filePath}?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`;
    const response = await fetch(apiUrl, {
        headers: {
            'Accept': 'application/vnd.github+json',
            'Authorization': 'Bearer ' + env.GITHUB_TOKEN,
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'Ascend-Admin-Worker'
        }
    });
    if (response.status === 404) return jsonResponse({ error: 'The requested GitHub file was not found.' }, 404, origin);
    if (!response.ok) {
        const error = new Error(`GitHub could not read ${filePath} (${response.status}).`);
        error.status = 502;
        throw error;
    }

    const file = await response.json();
    if (file.encoding !== 'base64' || typeof file.content !== 'string') {
        const error = new Error(`GitHub returned an unsupported format for ${filePath}.`);
        error.status = 502;
        throw error;
    }
    let content;
    try {
        content = JSON.parse(new TextDecoder().decode(base64ToBytes(file.content.replace(/\s/g, ''))));
    } catch {
        const error = new Error(`GitHub returned invalid JSON for ${filePath}.`);
        error.status = 502;
        throw error;
    }
    if (!Array.isArray(content)) {
        const error = new Error('Published property data has an invalid format.');
        error.status = 502;
        throw error;
    }
    const validationError = validateProperties(content);
    if (validationError) {
        const error = new Error(`Published property data is invalid: ${validationError}`);
        error.status = 502;
        throw error;
    }
    return jsonResponse({ content }, 200, origin);
}

function validateProperties(properties) {
    if (!Array.isArray(properties) || properties.length > 500) return 'Properties must be an array with at most 500 entries.';
    const ids = new Set();
    for (const property of properties) {
        if (!property || typeof property !== 'object' || Array.isArray(property)) return 'Each property must be an object.';
        if (!Number.isSafeInteger(property.id) || ids.has(property.id)) return 'Each property needs a unique integer id.';
        ids.add(property.id);
        if (typeof property.title !== 'string' || !property.title.trim() || property.title.length > 200) return 'Property title is invalid.';
        if (property.description !== undefined && (typeof property.description !== 'string' || property.description.length > 5000)) return 'Property description is invalid.';
        if (typeof property.location !== 'string' || !property.location.trim() || property.location.length > 200) return 'Property location is invalid.';
        if (property.titleEn !== undefined && (typeof property.titleEn !== 'string' || property.titleEn.length > 200)) return 'English property title is invalid.';
        if (property.descriptionEn !== undefined && (typeof property.descriptionEn !== 'string' || property.descriptionEn.length > 5000)) return 'English property description is invalid.';
        if (property.locationEn !== undefined && (typeof property.locationEn !== 'string' || property.locationEn.length > 200)) return 'English property location is invalid.';
        if (!Number.isFinite(property.price) || property.price <= 0) return 'Property price is invalid.';
        if (![property.beds, property.baths, property.area].every(value => Number.isFinite(value) && value >= 0)) return 'Property dimensions are invalid.';
        if (!['villa', 'apartment', 'duplex', 'penthouse', 'office'].includes(property.type)) return 'Property type is invalid.';
        if (!['buy', 'rent'].includes(property.action || 'buy')) return 'Property action is invalid.';
        const images = Array.isArray(property.images) ? property.images : [property.img];
        if (!images.length || images.length > 20 || images.some(image => !isHttpsUrl(image))) return 'Property images must be HTTPS URLs (up to 20 images).';
    }
    return '';
}

function isHttpsUrl(value) {
    if (typeof value !== 'string' || value.length > 2048) return false;
    try {
        return new URL(value).protocol === 'https:';
    } catch {
        return false;
    }
}

async function uploadImage(request, env, origin) {
    const body = await parseJson(request);
    const extension = typeof body.name === 'string' ? body.name.split('.').pop().toLowerCase() : '';
    const content = body.content;
    if (!ALLOWED_IMAGE_EXTENSIONS.has(extension) || typeof content !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(content)) {
        return jsonResponse({ error: 'Invalid image file.' }, 400, origin);
    }
    if (content.length > 7_000_000) return jsonResponse({ error: 'Image exceeds the 5 MB limit.' }, 413, origin);
    let imageBytes;
    try {
        imageBytes = base64ToBytes(content);
    } catch {
        return jsonResponse({ error: 'Invalid image data.' }, 400, origin);
    }
    if (imageBytes.length > 5 * 1024 * 1024 || !isValidImage(imageBytes, extension)) {
        return jsonResponse({ error: 'Image content does not match its file type or exceeds 5 MB.' }, 400, origin);
    }
    const fileName = `img_${crypto.randomUUID()}.${extension}`;
    await writeGitHubFile(env, `images/${fileName}`, imageBytes, `Upload ${fileName}`);
    return jsonResponse({
        url: `https://raw.githubusercontent.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/${env.GITHUB_BRANCH}/images/${fileName}`
    }, 201, origin);
}

function isValidImage(bytes, extension) {
    const startsWith = (...signature) => signature.every((byte, index) => bytes[index] === byte);
    if (extension === 'jpg' || extension === 'jpeg') return startsWith(0xff, 0xd8, 0xff);
    if (extension === 'png') return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    if (extension === 'gif') return startsWith(0x47, 0x49, 0x46, 0x38, 0x37, 0x61) || startsWith(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);
    if (extension === 'webp') return startsWith(0x52, 0x49, 0x46, 0x46) && bytes.length >= 12 && startsWithAt(bytes, 8, [0x57, 0x45, 0x42, 0x50]);
    return false;
}

function startsWithAt(bytes, offset, signature) {
    return signature.every((byte, index) => bytes[offset + index] === byte);
}

async function writeGitHubFile(env, filePath, contentBytes, message) {
    if (!env.GITHUB_TOKEN) {
        const error = new Error('GitHub access is not configured on the Worker.');
        error.status = 503;
        throw error;
    }
    const apiUrl = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${filePath}`;
    const authorization = 'Bearer ' + env.GITHUB_TOKEN;
    const headers = {
        'Accept': 'application/vnd.github+json',
        'Authorization': authorization,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Ascend-Admin-Worker'
    };
    const existing = await fetch(`${apiUrl}?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`, { headers });
    let sha;
    if (existing.ok) {
        sha = (await existing.json()).sha;
    } else if (existing.status !== 404) {
        throw new Error(`GitHub could not read ${filePath} (${existing.status}).`);
    }
    const response = await fetch(apiUrl, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message,
            branch: env.GITHUB_BRANCH,
            content: bytesToBase64(contentBytes),
            ...(sha ? { sha } : {})
        })
    });
    if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        console.error('GitHub content update failed:', response.status, errorBody.message);
        const error = new Error(`GitHub rejected the update (${response.status}).`);
        error.status = 502;
        throw error;
    }
}

function bytesToBase64(bytes) {
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return btoa(binary);
}

function base64ToBytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
}
