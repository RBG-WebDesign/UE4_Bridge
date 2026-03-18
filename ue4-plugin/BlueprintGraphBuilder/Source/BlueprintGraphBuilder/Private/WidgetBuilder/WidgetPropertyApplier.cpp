#include "WidgetPropertyApplier.h"
#include "Dom/JsonObject.h"
#include "Components/Widget.h"
#include "Components/TextBlock.h"

static ESlateVisibility ParseVisibility(const FString& Value)
{
    if (Value == TEXT("Collapsed")) return ESlateVisibility::Collapsed;
    if (Value == TEXT("Hidden")) return ESlateVisibility::Hidden;
    if (Value == TEXT("HitTestInvisible")) return ESlateVisibility::HitTestInvisible;
    if (Value == TEXT("SelfHitTestInvisible")) return ESlateVisibility::SelfHitTestInvisible;
    return ESlateVisibility::Visible;
}

static ETextJustify::Type ParseJustification(const FString& Value)
{
    if (Value == TEXT("Center")) return ETextJustify::Center;
    if (Value == TEXT("Right")) return ETextJustify::Right;
    return ETextJustify::Left;
}

bool FWidgetPropertyApplier::ApplyProperties(
    UWidget* Widget,
    const FString& TypeName,
    const TMap<FString, TSharedPtr<FJsonValue>>& Properties,
    const FString& Path,
    FString& OutError)
{
    if (!Widget || Properties.Num() == 0)
    {
        return true;
    }

    // Common widget properties (apply to all widget types)
    const TSharedPtr<FJsonValue>* VisVal = Properties.Find(TEXT("visibility"));
    if (VisVal && (*VisVal)->Type == EJson::String)
    {
        Widget->SetVisibility(ParseVisibility((*VisVal)->AsString()));
        UE_LOG(LogTemp, Log, TEXT("[WidgetBuilder] %s: visibility = %s"), *Path, *(*VisVal)->AsString());
    }

    const TSharedPtr<FJsonValue>* OpacityVal = Properties.Find(TEXT("renderOpacity"));
    if (OpacityVal && (*OpacityVal)->Type == EJson::Number)
    {
        Widget->SetRenderOpacity(static_cast<float>((*OpacityVal)->AsNumber()));
        UE_LOG(LogTemp, Log, TEXT("[WidgetBuilder] %s: renderOpacity = %f"), *Path, (*OpacityVal)->AsNumber());
    }

    const TSharedPtr<FJsonValue>* EnabledVal = Properties.Find(TEXT("isEnabled"));
    if (EnabledVal && (*EnabledVal)->Type == EJson::Boolean)
    {
        Widget->SetIsEnabled((*EnabledVal)->AsBool());
    }

    // TextBlock-specific properties
    if (TypeName == TEXT("TextBlock"))
    {
        UTextBlock* TextBlock = Cast<UTextBlock>(Widget);
        if (TextBlock)
        {
            const TSharedPtr<FJsonValue>* TextVal = Properties.Find(TEXT("text"));
            if (TextVal && (*TextVal)->Type == EJson::String)
            {
                TextBlock->SetText(FText::FromString((*TextVal)->AsString()));
                UE_LOG(LogTemp, Log, TEXT("[WidgetBuilder] %s: text = '%s'"), *Path, *(*TextVal)->AsString());
            }

            const TSharedPtr<FJsonValue>* JustVal = Properties.Find(TEXT("justification"));
            if (JustVal && (*JustVal)->Type == EJson::String)
            {
                TextBlock->SetJustification(ParseJustification((*JustVal)->AsString()));
            }

            const TSharedPtr<FJsonValue>* ColorVal = Properties.Find(TEXT("color"));
            if (ColorVal && (*ColorVal)->Type == EJson::Object)
            {
                const TSharedPtr<FJsonObject>& ColorObj = (*ColorVal)->AsObject();
                FLinearColor Color(
                    static_cast<float>(ColorObj->GetNumberField(TEXT("r"))),
                    static_cast<float>(ColorObj->GetNumberField(TEXT("g"))),
                    static_cast<float>(ColorObj->GetNumberField(TEXT("b"))),
                    ColorObj->HasField(TEXT("a")) ? static_cast<float>(ColorObj->GetNumberField(TEXT("a"))) : 1.0f
                );
                TextBlock->SetColorAndOpacity(FSlateColor(Color));
            }
        }
    }

    return true;
}
