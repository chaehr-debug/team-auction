// ============================================================
// 화면 구성표 — "어떤 단계에서, 누구에게, 어떤 패널을, 어떤 레이아웃으로" 보여줄지.
// 패널 배치(위치/크기)는 css/layout.css 의 layout-* 클래스에서 조정합니다.
// ============================================================

export const VIEWS = {
  prep: {
    observer: { layout: 'layout-prep-observer', panels: ['header', 'controls', 'order', 'share', 'directors'] },
    director: { layout: 'layout-prep-director', panels: ['header', 'order', 'me', 'directors'] },
    viewer:   { layout: 'layout-prep-director', panels: ['header', 'order', 'directors'] },
  },
  auction: {
    observer: { layout: 'layout-auction-observer', panels: ['header', 'queue', 'lot', 'directors', 'cam', 'log'] },
    director: { layout: 'layout-auction-director', panels: ['header', 'queue', 'lot', 'directors', 'me', 'bid', 'log'] },
    viewer:   { layout: 'layout-auction-viewer',   panels: ['header', 'queue', 'lot', 'directors', 'log'] },
  },
  result: {
    observer: { layout: 'layout-result', panels: ['header', 'teams', 'unassigned'] },
    director: { layout: 'layout-result', panels: ['header', 'teams', 'unassigned'] },
    viewer:   { layout: 'layout-result', panels: ['header', 'teams', 'unassigned'] },
  },
};
// 유찰 경매는 경매 화면을 그대로 사용
VIEWS.rebid = VIEWS.auction;

/** 방송 오버레이 기본 패널 (overlay.html?panels=lot,log 로 변경 가능)
 *  로그는 채팅창형 오버레이(?panels=log)로 따로 띄우므로 기본 화면엔 '다음 경매 순서'를 둔다 */
export const OVERLAY_DEFAULT = ['directors', 'lot', 'cam', 'upcoming'];
