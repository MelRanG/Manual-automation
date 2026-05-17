import uuid

from app.models import (
    User,
    Document,
    DocumentVersion,
    DocumentChunk,
    ChatSession,
    ChatMessage,
    AnswerCitation,
    FeedbackReport,
    ProposedDocumentChange,
    ApprovalRequest,
    SRDraft,
    WebhookDeliveryLog,
    ChangeImpactAnalysis,
    DocumentChangeProposal,
)


def test_user_model_fields():
    u = User(id=uuid.uuid4(), name="Test", email="t@t.com", role="admin")
    assert u.name == "Test"
    assert u.role == "admin"


def test_document_model_fields():
    d = Document(id=uuid.uuid4(), title="Doc", status="active", trust_score=0.9)
    assert d.title == "Doc"
    assert d.trust_score == 0.9


def test_all_models_importable():
    models = [
        User, Document, DocumentVersion, DocumentChunk,
        ChatSession, ChatMessage, AnswerCitation,
        FeedbackReport, ProposedDocumentChange, ApprovalRequest,
        SRDraft, WebhookDeliveryLog, ChangeImpactAnalysis,
        DocumentChangeProposal,
    ]
    assert len(models) == 14
