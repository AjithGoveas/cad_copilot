import * as pdfjs from 'pdfjs-dist';

// Set worker source for PDF.js. Use dynamic version from the package.
if (typeof window !== 'undefined') {
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
}

/**
 * Rasterizes the first page of a PDF file to a WebP image Blob at 300 DPI.
 * @param file The PDF File object upload
 * @param dpi The target DPI (defaults to 300 for blueprint precision)
 */
export async function rasterizePdfToWebP(file: File, dpi = 300): Promise<Blob> {
  const arrayBuffer = await file.arrayBuffer();
  
  // Load the document using PDF.js
  const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  
  if (pdf.numPages === 0) {
    throw new Error('The PDF document contains no pages.');
  }

  // Get the first page of the blueprint
  const page = await pdf.getPage(1);
  
  // Calculate rendering scale (default PDF scale is 72 DPI)
  const scale = dpi / 72;
  const viewport = page.getViewport({ scale });

  // Create offscreen canvas element
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Failed to retrieve 2D canvas drawing context.');
  }

  // Render the PDF page into canvas context
  const renderContext = {
    canvasContext: context,
    viewport: viewport,
  };
  await page.render(renderContext).promise;

  // Convert canvas contents to a high-quality WebP blob (95% quality)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Canvas conversion to WebP Blob failed.'));
      }
    }, 'image/webp', 0.95);
  });
}
