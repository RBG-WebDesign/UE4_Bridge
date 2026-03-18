#include "WidgetClassRegistry.h"
#include "Components/CanvasPanel.h"
#include "Components/VerticalBox.h"
#include "Components/HorizontalBox.h"
#include "Components/Overlay.h"
#include "Components/Widget.h"
#include "Components/TextBlock.h"
#include "Components/Image.h"
#include "Components/Spacer.h"
#include "Components/Button.h"
#include "Components/Border.h"
#include "Components/SizeBox.h"

FWidgetClassRegistry::FWidgetClassRegistry()
{
	RegisterTypes();
}

void FWidgetClassRegistry::AddCommonProperties(FWidgetTypeInfo& Info)
{
	Info.SupportedProperties.Add({TEXT("visibility"), EJson::String});
	Info.SupportedProperties.Add({TEXT("renderOpacity"), EJson::Number});
	Info.SupportedProperties.Add({TEXT("isEnabled"), EJson::Boolean});
}

void FWidgetClassRegistry::RegisterTypes()
{
	// Pass 1: CanvasPanel
	FWidgetTypeInfo CanvasPanelInfo;
	CanvasPanelInfo.WidgetClass = UCanvasPanel::StaticClass();
	CanvasPanelInfo.Category = EWidgetCategory::Panel;
	AddCommonProperties(CanvasPanelInfo);
	TypeRegistry.Add(TEXT("CanvasPanel"), MoveTemp(CanvasPanelInfo));

	// Pass 2: Leaf widgets
	FWidgetTypeInfo TextBlockInfo;
	TextBlockInfo.WidgetClass = UTextBlock::StaticClass();
	TextBlockInfo.Category = EWidgetCategory::Leaf;
	AddCommonProperties(TextBlockInfo);
	TextBlockInfo.SupportedProperties.Add({TEXT("text"), EJson::String});
	TextBlockInfo.SupportedProperties.Add({TEXT("justification"), EJson::String});
	TextBlockInfo.SupportedProperties.Add({TEXT("color"), EJson::Object});
	TypeRegistry.Add(TEXT("TextBlock"), MoveTemp(TextBlockInfo));

	FWidgetTypeInfo ImageInfo;
	ImageInfo.WidgetClass = UImage::StaticClass();
	ImageInfo.Category = EWidgetCategory::Leaf;
	AddCommonProperties(ImageInfo);
	TypeRegistry.Add(TEXT("Image"), MoveTemp(ImageInfo));

	FWidgetTypeInfo SpacerInfo;
	SpacerInfo.WidgetClass = USpacer::StaticClass();
	SpacerInfo.Category = EWidgetCategory::Leaf;
	AddCommonProperties(SpacerInfo);
	TypeRegistry.Add(TEXT("Spacer"), MoveTemp(SpacerInfo));

	// Pass 3: Layout panels
	FWidgetTypeInfo VerticalBoxInfo;
	VerticalBoxInfo.WidgetClass = UVerticalBox::StaticClass();
	VerticalBoxInfo.Category = EWidgetCategory::Panel;
	AddCommonProperties(VerticalBoxInfo);
	TypeRegistry.Add(TEXT("VerticalBox"), MoveTemp(VerticalBoxInfo));

	FWidgetTypeInfo HorizontalBoxInfo;
	HorizontalBoxInfo.WidgetClass = UHorizontalBox::StaticClass();
	HorizontalBoxInfo.Category = EWidgetCategory::Panel;
	AddCommonProperties(HorizontalBoxInfo);
	TypeRegistry.Add(TEXT("HorizontalBox"), MoveTemp(HorizontalBoxInfo));

	FWidgetTypeInfo OverlayInfo;
	OverlayInfo.WidgetClass = UOverlay::StaticClass();
	OverlayInfo.Category = EWidgetCategory::Panel;
	AddCommonProperties(OverlayInfo);
	TypeRegistry.Add(TEXT("Overlay"), MoveTemp(OverlayInfo));

	// Pass 4: Content widgets (single child)
	FWidgetTypeInfo ButtonInfo;
	ButtonInfo.WidgetClass = UButton::StaticClass();
	ButtonInfo.Category = EWidgetCategory::Content;
	AddCommonProperties(ButtonInfo);
	TypeRegistry.Add(TEXT("Button"), MoveTemp(ButtonInfo));

	FWidgetTypeInfo BorderInfo;
	BorderInfo.WidgetClass = UBorder::StaticClass();
	BorderInfo.Category = EWidgetCategory::Content;
	AddCommonProperties(BorderInfo);
	TypeRegistry.Add(TEXT("Border"), MoveTemp(BorderInfo));

	FWidgetTypeInfo SizeBoxInfo;
	SizeBoxInfo.WidgetClass = USizeBox::StaticClass();
	SizeBoxInfo.Category = EWidgetCategory::Content;
	AddCommonProperties(SizeBoxInfo);
	TypeRegistry.Add(TEXT("SizeBox"), MoveTemp(SizeBoxInfo));
}

TSubclassOf<UWidget> FWidgetClassRegistry::ResolveWidgetClass(const FString& TypeName) const
{
	const FWidgetTypeInfo* Info = TypeRegistry.Find(TypeName);
	return Info ? Info->WidgetClass : nullptr;
}

bool FWidgetClassRegistry::IsSupportedType(const FString& TypeName) const
{
	return TypeRegistry.Contains(TypeName);
}

EWidgetCategory FWidgetClassRegistry::GetCategory(const FString& TypeName) const
{
	const FWidgetTypeInfo* Info = TypeRegistry.Find(TypeName);
	return Info ? Info->Category : EWidgetCategory::Leaf;
}

TArray<FString> FWidgetClassRegistry::GetSupportedTypes() const
{
	TArray<FString> Types;
	TypeRegistry.GetKeys(Types);
	return Types;
}

const TArray<FWidgetPropertyDescriptor>* FWidgetClassRegistry::GetSupportedProperties(const FString& TypeName) const
{
	const FWidgetTypeInfo* Info = TypeRegistry.Find(TypeName);
	return Info ? &Info->SupportedProperties : nullptr;
}
