import { useEffect, useRef, useState, forwardRef } from "react";
import HTMLFlipBook from "react-pageflip";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import "./App.css";
import logo from "./assets/logo.webp";
import latSachSound from "./assets/lat_sach.mp3";

// Cấu hình worker cho pdfjs - sử dụng worker từ public folder
if (typeof window !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
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
    try {
      setError(`Đang load trang ${pageNumber}...`);
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 2 });

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) {
        const errMsg = `LỖI: Không thể lấy canvas context cho trang ${pageNumber}`;
        setError(errMsg);
        throw new Error(errMsg);
      }

      canvas.height = viewport.height;
      canvas.width = viewport.width;

      await page.render({
        canvasContext: context,
        viewport: viewport,
        canvas: canvas,
      }).promise;

      setError(null);
      return canvas.toDataURL("image/png");
    } catch (err) {
      const errMsg = `LỖI load trang ${pageNumber}: ${err instanceof Error ? err.message : String(err)}`;
      setError(errMsg);
      throw err;
    }
  };

  useEffect(() => {
    const loadPDF = async () => {
      try {
        setError("Đang tải PDF document...");
        // Load PDF document
        const loadingTask = pdfjsLib.getDocument(pdfUrl);
        const pdf = await loadingTask.promise;
        setError("Đã tải PDF, đang lấy số trang...");
        const numPages = pdf.numPages;
        setTotalPages(numPages);
        pdfRef.current = pdf;
        setError(`Đã tải PDF thành công. Tổng số trang: ${numPages}`);

        // Khởi tạo mảng pages với null cho các trang chưa load
        const initialPages: (string | null)[] = new Array(numPages).fill(null);
        setPages(initialPages);

        // Load trước một số trang đầu tiên để hiển thị ngay
        setError(`Đang load ${INITIAL_PAGES_TO_LOAD} trang đầu tiên...`);
        const pagesToLoadInitially = Math.min(INITIAL_PAGES_TO_LOAD, numPages);
        const initialPageImages: string[] = [];

        for (let i = 1; i <= pagesToLoadInitially; i++) {
          setError(`Đang load trang ${i}/${pagesToLoadInitially}...`);
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

        setError("Đã load xong các trang đầu tiên. Đang ẩn loading...");
        setIsLoading(false);
        setError(null);

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
            } catch (error) {
              console.error(`Error loading page ${i}:`, error);
            }
          }
        };

        // Bắt đầu load các trang còn lại sau một chút delay
        setTimeout(() => {
          loadRemainingPages();
        }, 500);
      } catch (error) {
        const errMsg = `LỖI load PDF: ${error instanceof Error ? error.message : String(error)}`;
        console.error("Error loading PDF:", error);
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
            } catch (error) {
              console.error(`Error loading page ${i}:`, error);
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
        setError("Đang kiểm tra flipbook ready state...");
        const pageFlip = flipBookRef.current?.getPageFlip?.() || flipBookRef.current?.pageFlip?.();
        if (pageFlip) {
          try {
            setError("Đang lấy số trang từ flipbook...");
            const count = pageFlip.getPageCount();
            setTotalPages(count);
            setIsFlipBookReady(true);
            setError("Flipbook đã sẵn sàng!");
            setTimeout(() => setError(null), 1000);
            return true;
          } catch (error) {
            const errMsg = `LỖI get page count: ${error instanceof Error ? error.message : String(error)}`;
            console.error("Error getting page count:", error);
            setError(errMsg);
            // Fallback: set ready anyway nếu có lỗi
            setIsFlipBookReady(true);
            return true;
          }
        }
        setError("Flipbook chưa sẵn sàng, pageFlip không tồn tại");
        return false;
      };

      let timeout1: ReturnType<typeof setTimeout> | null = null;
      let timeout2: ReturnType<typeof setTimeout> | null = null;
      let timeout3: ReturnType<typeof setTimeout> | null = null;

      // Thử ngay lập tức
      setError("Thử kiểm tra flipbook ngay lập tức...");
      if (checkAndSetReady()) {
        return;
      }

      // Nếu chưa sẵn sàng, thử lại sau 100ms
      setError("Flipbook chưa sẵn sàng, thử lại sau 100ms...");
      timeout1 = setTimeout(() => {
        if (checkAndSetReady()) {
          return;
        }
        // Nếu vẫn chưa sẵn sàng, thử lại sau 300ms
        setError("Flipbook vẫn chưa sẵn sàng, thử lại sau 300ms...");
        timeout2 = setTimeout(() => {
          if (checkAndSetReady()) {
            return;
          }
          // Fallback cuối cùng: set ready sau 500ms ngay cả khi không thể lấy pageFlip
          // Điều này đảm bảo flipbook sẽ hiển thị trên mọi iPhone
          setError("Fallback: Tự động set flipbook ready sau 500ms...");
          timeout3 = setTimeout(() => {
            setIsFlipBookReady(true);
            setError("Đã set flipbook ready bằng fallback!");
            setTimeout(() => setError(null), 1000);
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
  // Nếu sau khi loading xong mà isFlipBookReady vẫn chưa được set sau 1.5 giây, tự động set nó
  useEffect(() => {
    if (!isLoading && pages.length > 0 && !isFlipBookReady) {
      setError("Fallback: Đang đợi 1.5 giây để set flipbook ready...");
      const fallbackTimeout = setTimeout(() => {
        setError("Fallback: Đã set flipbook ready sau 1.5 giây!");
        setIsFlipBookReady(true);
        setTimeout(() => setError(null), 1000);
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
      audioRef.current.play().catch((error) => {
        console.error("Error playing sound:", error);
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
            <h2 className="error-title">DEBUG INFO</h2>
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
            maxShadowOpacity={0.5}
            showCover={false}
            mobileScrollSupport={true}
            flippingTime={800}
            drawShadow={true}
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
