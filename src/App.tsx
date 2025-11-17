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
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2 });

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Cannot get canvas context");

    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({
      canvasContext: context,
      viewport: viewport,
      canvas: canvas,
    }).promise;

    return canvas.toDataURL("image/png");
  };

  useEffect(() => {
    const loadPDF = async () => {
      try {
        // Load PDF document
        const loadingTask = pdfjsLib.getDocument(pdfUrl);
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
        console.error("Error loading PDF:", error);
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
    if (flipBookRef.current && pages.length > 0) {
      // Sử dụng setTimeout để đảm bảo HTMLFlipBook đã được mount hoàn toàn
      setTimeout(() => {
        const pageFlip = flipBookRef.current?.getPageFlip?.() || flipBookRef.current?.pageFlip?.();
        if (pageFlip) {
          const count = pageFlip.getPageCount();
          setTotalPages(count);
          // Đánh dấu flipbook đã sẵn sàng sau khi đã khởi tạo xong
          setIsFlipBookReady(true);
        }
      }, 100);
    }
  }, [pages]);

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
