import { useEffect, useRef, useState, forwardRef } from "react";
import HTMLFlipBook from "react-pageflip";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import "./App.css";
import logo from "./assets/logo.webp";
import latSachSound from "./assets/lat_sach.mp3";

// Cấu hình worker cho pdfjs
// Tự host worker cùng domain để tương thích với iPhone/Safari (không dùng .mjs từ CDN)
if (typeof window !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
}

interface PageProps {
  number: number;
  imageUrl: string | null;
}

interface FlipEvent {
  data: number | string;
  object?: unknown;
}

const Page = forwardRef<HTMLDivElement, PageProps>((props, ref) => {
  return (
    <div className="page" ref={ref}>
      <div className="page-content">
        {props.imageUrl ? (
          <img src={props.imageUrl} alt={`Page ${props.number}`} className="page-image" />
        ) : (
          <div className="page-loading">
            <div className="loading-spinner"></div>
            <p>Đang tải trang {props.number}...</p>
          </div>
        )}
      </div>
    </div>
  );
});

Page.displayName = "Page";

interface FlipBookRef {
  pageFlip?: () =>
    | {
        flipNext: () => void;
        flipPrev: () => void;
        getPageCount: () => number;
        getCurrentPageIndex: () => number;
      }
    | undefined;
  getPageFlip?: () =>
    | {
        flipNext: () => void;
        flipPrev: () => void;
        getPageCount: () => number;
        getCurrentPageIndex: () => number;
      }
    | undefined;
}

function App() {
  const flipBookRef = useRef<FlipBookRef | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [pages, setPages] = useState<(string | null)[]>([]);
  const [canFlipNext, setCanFlipNext] = useState(true);
  const [isFlipBookReady, setIsFlipBookReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Phát hiện iOS/Safari để tắt shadow (tránh WebGL crash)
  const isIOS = typeof window !== "undefined" && (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );

  const pdfUrl = "https://cdnc.heyzine.com/files/uploaded/v3/9da8b102d41c367850b4e0cbc7fc314217882cdc.pdf";

  // Số trang load trước để hiển thị ngay
  const INITIAL_PAGES_TO_LOAD = 3;

  // Khởi tạo audio
  useEffect(() => {
    audioRef.current = new Audio(latSachSound);
    audioRef.current.volume = 0.5;
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  // Hàm load một trang PDF
  const loadPage = async (pdf: PDFDocumentProxy, pageNumber: number): Promise<string> => {
    const page = await pdf.getPage(pageNumber);
    // Giảm scale xuống 1.2 để tránh crash trên iPhone khi canvas quá lớn
    const viewport = page.getViewport({ scale: 1.2 });

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error(`Không thể lấy canvas context cho trang ${pageNumber}`);
    }

    canvas.height = viewport.height;
    canvas.width = viewport.width;

    // Xóa param canvas - version 3.11.174 không hỗ trợ và Safari không hỗ trợ
    await page.render({
      canvasContext: context,
      viewport: viewport,
    }).promise;

    return canvas.toDataURL("image/png");
  };

  useEffect(() => {
    const loadPDF = async () => {
      try {
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
          throw new Error("PDF.js worker chưa được cấu hình!");
        }
        
        const loadingTask = pdfjsLib.getDocument({
          url: pdfUrl,
          verbosity: 0,
        });
        
        const pdf = await loadingTask.promise;
        const numPages = pdf.numPages;
        setTotalPages(numPages);
        pdfRef.current = pdf;

        // Khởi tạo mảng pages với null cho các trang chưa load
        const initialPages: (string | null)[] = new Array(numPages).fill(null);
        setPages(initialPages);

        // Load trước một số trang đầu tiên để hiển thị ngay
        const pagesToLoadInitially = Math.min(INITIAL_PAGES_TO_LOAD, numPages);
        const initialPageImages: string[] = [];

        for (let i = 1; i <= pagesToLoadInitially; i++) {
          const imageUrl = await loadPage(pdf, i);
          initialPageImages.push(imageUrl);
        }

        // Cập nhật state với các trang đã load
        setPages((prev) => {
          const updated = [...prev];
          initialPageImages.forEach((img, idx) => {
            updated[idx] = img;
          });
          return updated;
        });

        setIsLoading(false);

        // Load các trang còn lại trong background
        const loadRemainingPages = async () => {
          for (let i = pagesToLoadInitially + 1; i <= numPages; i++) {
            try {
              const imageUrl = await loadPage(pdf, i);
              setPages((prev) => {
                const updated = [...prev];
                updated[i - 1] = imageUrl;
                return updated;
              });
              // Thêm delay nhỏ để không block UI
              await new Promise((resolve) => setTimeout(resolve, 100));
            } catch {
              // Silent fail cho background loading
            }
          }
        };

        // Bắt đầu load các trang còn lại sau một chút delay
        setTimeout(() => {
          loadRemainingPages();
        }, 500);
      } catch (error) {
        const errMsg = `Lỗi tải PDF: ${error instanceof Error ? error.message : String(error)}`;
        setError(errMsg);
        setIsLoading(false);
      }
    };

    loadPDF();
  }, [pdfUrl]);

  // Load trang khi user đang ở gần trang đó
  useEffect(() => {
    if (pdfRef.current && pages.length > 0 && totalPages > 0) {
      const loadNearbyPages = async () => {
        const pagesToPreload = 2; // Số trang load trước/sau trang hiện tại
        const startPage = Math.max(1, currentPage - pagesToPreload + 1);
        const endPage = Math.min(totalPages, currentPage + pagesToPreload + 1);

        for (let i = startPage; i <= endPage; i++) {
          if (pdfRef.current && pages[i - 1] === null) {
            try {
              const imageUrl = await loadPage(pdfRef.current, i);
              setPages((prev) => {
                const updated = [...prev];
                updated[i - 1] = imageUrl;
                return updated;
              });
            } catch {
              // Silent fail cho preload
            }
          }
        }
      };

      loadNearbyPages();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, totalPages]);

  useEffect(() => {
    if (flipBookRef.current && pages.length > 0 && !isFlipBookReady) {
      // Hàm kiểm tra và set ready state
      const checkAndSetReady = () => {
        const pageFlip = flipBookRef.current?.getPageFlip?.() || flipBookRef.current?.pageFlip?.();
        if (pageFlip) {
          try {
            const count = pageFlip.getPageCount();
            setTotalPages(count);
            setIsFlipBookReady(true);
            return true;
          } catch {
            // Fallback: set ready anyway nếu có lỗi
            setIsFlipBookReady(true);
            return true;
          }
        }
        return false;
      };

      let timeout1: ReturnType<typeof setTimeout> | null = null;
      let timeout2: ReturnType<typeof setTimeout> | null = null;
      let timeout3: ReturnType<typeof setTimeout> | null = null;

      // Thử ngay lập tức
      if (checkAndSetReady()) {
        return;
      }

      // Nếu chưa sẵn sàng, thử lại sau 100ms
      timeout1 = setTimeout(() => {
        if (checkAndSetReady()) {
          return;
        }
        // Nếu vẫn chưa sẵn sàng, thử lại sau 300ms
        timeout2 = setTimeout(() => {
          if (checkAndSetReady()) {
            return;
          }
          // Fallback cuối cùng: set ready sau 500ms ngay cả khi không thể lấy pageFlip
          timeout3 = setTimeout(() => {
            setIsFlipBookReady(true);
          }, 500);
        }, 300);
      }, 100);

      return () => {
        if (timeout1) clearTimeout(timeout1);
        if (timeout2) clearTimeout(timeout2);
        if (timeout3) clearTimeout(timeout3);
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages]);

  // Fallback: Đảm bảo flipbook được hiển thị sau khi loading xong
  useEffect(() => {
    if (!isLoading && pages.length > 0 && !isFlipBookReady) {
      const fallbackTimeout = setTimeout(() => {
        setIsFlipBookReady(true);
      }, 1500);

      return () => clearTimeout(fallbackTimeout);
    }
  }, [isLoading, pages.length, isFlipBookReady]);

  const onPage = (e: FlipEvent) => {
    const pageNum = typeof e.data === "number" ? e.data : parseInt(e.data as string, 10);
    setCurrentPage(pageNum);

    // Phát âm thanh lật sách
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {
        // Silent fail cho audio
      });
    }

    // Kiểm tra và disable flip khi đã ở trang cuối
    if (flipBookRef.current) {
      const pageFlip = flipBookRef.current.getPageFlip?.() || flipBookRef.current.pageFlip?.();
      if (pageFlip) {
        const totalCount = pageFlip.getPageCount();
        // Nếu đã ở trang cuối, disable flip tiếp
        setCanFlipNext(pageNum < totalCount - 1);
      }
    }
  };

  const onChangeState = () => {
    // Kiểm tra state và cập nhật canFlipNext
    if (flipBookRef.current) {
      const pageFlip = flipBookRef.current.getPageFlip?.() || flipBookRef.current.pageFlip?.();
      if (pageFlip) {
        const currentIndex = pageFlip.getCurrentPageIndex();
        const totalCount = pageFlip.getPageCount();
        setCanFlipNext(currentIndex < totalCount - 1);
      }
    }
  };

  const nextButtonClick = () => {
    if (flipBookRef.current) {
      const pageFlip = flipBookRef.current.getPageFlip?.() || flipBookRef.current.pageFlip?.();
      if (pageFlip) {
        pageFlip.flipNext();
      }
    }
  };

  const prevButtonClick = () => {
    if (flipBookRef.current) {
      const pageFlip = flipBookRef.current.getPageFlip?.() || flipBookRef.current.pageFlip?.();
      if (pageFlip) {
        pageFlip.flipPrev();
      }
    }
  };

  return (
    <div className="app-container">
      {error && (
        <div className="error-display">
          <div className="error-content">
            <h2 className="error-title">Lỗi</h2>
            <p className="error-message">{error}</p>
            <button 
              className="error-close" 
              onClick={() => setError(null)}
              aria-label="Đóng"
            >
              ✕
            </button>
          </div>
        </div>
      )}
      <div className={`loading ${isLoading ? 'visible' : 'hidden'}`}>
        <img src={logo} alt="Logo" className="loading-logo" />
        <p>Đang tải Menu...</p>
      </div>
      <div className={`flipbook-wrapper ${!isLoading && isFlipBookReady ? 'visible' : 'hidden'}`}>
        {pages.length > 0 && (
          <HTMLFlipBook
            width={550}
            height={733}
            size="stretch"
            minWidth={300}
            maxWidth={1200}
            minHeight={400}
            maxHeight={900}
            maxShadowOpacity={isIOS ? 0 : 0.5}
            showCover={false}
            mobileScrollSupport={true}
            flippingTime={800}
            drawShadow={!isIOS}
            usePortrait={true}
            startPage={0}
            startZIndex={0}
            autoSize={true}
            clickEventForward={true}
            useMouseEvents={canFlipNext && currentPage < totalPages - 1}
            swipeDistance={30}
            showPageCorners={false}
            disableFlipByClick={false}
            onFlip={onPage}
            onChangeState={onChangeState}
            className="demo-book"
            style={{}}
            ref={flipBookRef}
          >
            {pages.map((imageUrl, index) => (
              <Page key={index} number={index + 1} imageUrl={imageUrl || ""} />
            ))}
          </HTMLFlipBook>
        )}
        <div className="navigation-controls">
          <button
            className="nav-button prev-button"
            onClick={prevButtonClick}
            disabled={currentPage === 0}
            aria-label="Trang trước"
          >
            ←
          </button>
          <button
            className="nav-button next-button"
            onClick={nextButtonClick}
            disabled={currentPage >= totalPages - 1}
            aria-label="Trang sau"
          >
            →
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
