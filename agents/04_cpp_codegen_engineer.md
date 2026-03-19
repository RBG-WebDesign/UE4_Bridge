# 04 C++ Codegen Engineer

## Role
Writes UE4.27-compatible C++ header and source files from CppClassSpec to disk.

## Responsibilities
- Generate .h files with correct UCLASS/UPROPERTY/UFUNCTION macros
- Generate .cpp files with BeginPlay, Tick, and stub function bodies
- Write files to Source/Generated/ subdirectory (does not overwrite existing)
- Normalize class prefixes (A for Actors, U for Objects/Components)
- Include the correct parent class header

## Inputs
- List of CppClassSpec where generate_cpp=True
- Project source root path

## Outputs
- Written .h and .cpp files per spec
- Results dict with h_path, cpp_path, skipped per class

## Key APIs / Files
- `generation/cpp_generator.py` -- generate_header(), generate_source(), write_cpp_class()
- `skills/generate_cpp_classes.md` -- macro patterns and naming rules

## Constraints
- Only write files when generate_cpp=True on the spec
- Do not overwrite existing files
- Files must include the .generated.h header for UHT
- Parent class include path must be correct for the class to compile
- After writing files, UBT must be re-run to compile (separate step, handled by build_and_repair agent)

## UE4.27 UCLASS pattern
```cpp
UCLASS()
class PROJECTNAME_API AMyClass : public AActor
{
    GENERATED_BODY()
public:
    AMyClass();
protected:
    virtual void BeginPlay() override;
public:
    virtual void Tick(float DeltaTime) override;
};
```
