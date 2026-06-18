// Shared filename → MIME-type mapping (used for storage + download headers).
export const MIME_BY_EXT = {
  // documents
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // images
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff',
  // text / data
  txt: 'text/plain', csv: 'text/csv', json: 'application/json', xml: 'application/xml',
  md: 'text/markdown', log: 'text/plain', html: 'text/html', yaml: 'text/yaml', yml: 'text/yaml',
  // archives / media
  zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed',
  gz: 'application/gzip', tar: 'application/x-tar',
  mp4: 'video/mp4', mp3: 'audio/mpeg', wav: 'audio/wav',
}

export function extOf(name = '') {
  return name.includes('.') ? name.toLowerCase().split('.').pop() : ''
}

export function mimeForName(name = '') {
  return MIME_BY_EXT[extOf(name)] || 'application/octet-stream'
}
