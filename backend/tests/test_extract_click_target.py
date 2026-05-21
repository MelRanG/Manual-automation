import pytest

from app.services.manual_service import _extract_click_target


@pytest.mark.parametrize(
    "step, expected",
    [
        # 기존 동작 보존
        ("뉴스 클릭", "뉴스"),
        ("뉴스클릭", "뉴스"),
        ("뉴스 선택", "뉴스"),
        ("뉴스 이동", "뉴스"),
        # descriptor 절단
        ("Demo Admin 버튼 클릭", "Demo Admin"),
        ("로그인 링크 클릭", "로그인"),
        ("설정 메뉴 진입", "설정"),
        ("탭 항목 선택", "탭"),
        # 활용형 어미
        ("메뉴를 선택해", "메뉴"),
        ("프로필을 클릭하세요", "프로필"),
        ("홈으로 이동하기", "홈"),
        # trailing 구두점
        ("Demo Admin 버튼 클릭...", "Demo Admin"),
        ("뉴스 클릭…", "뉴스"),
        ("뉴스 클릭!", "뉴스"),
        # descriptor만 남는 경우 — descriptor 유지
        ("메뉴", "메뉴"),
        ("메뉴 클릭", "메뉴"),
        # 영문 동사
        ("Sign In click", "Sign In"),
        ("Logout tap", "Logout"),
        # 안전 fallback
        ("", ""),
        ("   ", ""),
        ("그냥 텍스트", "그냥 텍스트"),
        # 페이지 어절 보존
        ("뉴스 페이지 이동", "뉴스 페이지"),
    ],
)
def test_extract_click_target(step: str, expected: str):
    assert _extract_click_target(step) == expected
